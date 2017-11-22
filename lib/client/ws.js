var net = require('net');
var url = require('url');
var utils = require('../utils');
var Client = require('../client');
var WebSocket = require('ws');
var Server = require('../server');

var WSOCK_CLOSE_CODE = 410; // HTTP Gone

/**
 *  Constructor for a Jayson WebSocket Client
 *  @class WebSocketClient
 *  @constructor
 *  @extends Client
 * 
 *  @param {Object|String} [options] Optional hash of settings or a URL
 *  @return {WebSocketClient}
 */
var WebSocketClient = function(options) {
  // accept first parameter as a url string
  if(typeof(options) === 'string') {
    options = url.parse(options);
  }

  if( !(this instanceof WebSocketClient) ) {
    return new WebSocketClient(options);
  }
  Client.call(this, options);

  this.options = utils.merge({
    // Option to use an existing (open) websocket if provided
    wsock: null,
    // Whether or not this client owns and manages the websocket
    // (optionally) passed in.
    ownsSock: false,
    // The (optional) client-side JSON-RPC server handling
    // bi-directional peer-to-peer requests from the remote
    // server.
    server: null
  }, this.options);
  this.pendingReq = {};
  this.reqQueue = [];
  this.wsock = this.options.wsock;
  if ( this.wsock ) {
    this._addWebSocketHandlers(this.wsock);
  }
};
require('util').inherits(WebSocketClient, Client);

module.exports = WebSocketClient;

WebSocketClient.prototype._request = function(request, callback) {
  var self = this;
  var wsock;

  function execute(conn) {
    var item;
    while ( self.reqQueue.length > 0 ) {
      item = self.reqQueue.shift();
      // Won't get anything for notifications, just end here
      if(utils.Request.isNotification(item.request)) {
        conn.send(item.body);
        item.callback();
      }
      else {
        // Keep track of pending requests
        self.pendingReq[item.request.id] = item;
        // Issue the request
        conn.send(item.body);
      }
    }
  }

  utils.JSON.stringify(request, this.options, function(err, body) {
    var address;

    if(err) {
      return callback(err);
    }

    self.reqQueue.push({ request: request, callback: callback, body: body});
    if ( self.wsock && (self.wsock.readyState === WebSocket.OPEN) ) {
      execute(self.wsock);
    }
    else if ( !self.wsock ) {
      address = self.options.href || self.options.address;
      if ( !address ) {
        address = 'ws://' + (self.options.host || self.options.hostname) +
                  ':' + self.options.port + (self.options.path || "");
      }
      wsock = new WebSocket(address, self.options.protocols, self.options);
      self.options.ownsSock = true;
      self.wsock = wsock;
      wsock.once('open', function() {
        self._addWebSocketHandlers(wsock);
        execute(wsock);
      });
    }
  });
};

WebSocketClient.prototype._addWebSocketHandlers = function(wsock) {
  this.wsErrorHandler = this._onWebSocketError.bind(this);
  wsock.on('error', this.wsErrorHandler);

  this.wsCloseHandler = this._onWebSocketClose.bind(this);
  wsock.once('close', this.wsCloseHandler);

  this.wsMessageHandler = this._onWebSocketMessage.bind(this);
  wsock.on('message', this.wsMessageHandler);
}

WebSocketClient.prototype._onWebSocketError = function(err) {
  var error = this.error(Server.errors.INTERNAL_ERROR, null, String(err));
  this.emit('ws error', error);
  this._resolvePending(error);
}

WebSocketClient.prototype._onWebSocketClose = function(code, reason) {
  this._resolvePending(this.error(Server.errors.INTERNAL_ERROR, String(reason), code));
}

WebSocketClient.prototype._onWebSocketMessage = function(data) {
  var self = this;
  utils.JSON.parse(data, this.options, function(err, response) {
    // If there is no error parsing the JSON-RPC data then ...
    if(!err) {
      self._onIncomingMessage(self.wsock, response);
    }

    // If there was an error, then it means the message received wasn't
    // correctly formatted JSON. We drop it in the bit-bucket.
  });
}


WebSocketClient.prototype._onIncomingMessage = function(conn, msg) {
  // Look up the matching request
  var item = this.pendingReq[msg.id];
  var self = this;

  // Ends the request with an error code
  function respondError(err) {
    var error = self.error(Server.errors.PARSE_ERROR, null, String(err));
    var response = utils.response(error, undefined, undefined, self.options.version);
    utils.JSON.stringify(response, options, function(strErr, body) {
      if(strErr) {
        body = ''; // we tried our best.
      }
      conn.send(body);
    });
  }

  // If we found the matching request informatin for a response then ...
  if ( item  ) {
    // Remove it from the collection of pending requests
    delete this.pendingReq[msg.id];
    item.callback(null, msg);
  }
  // Else if a request from the remote end then ...
  else if ( utils.Request.isValidRequest(msg, this.options.version) ) {
    // If there is a JSON-RPC server associated with this client then ...
    if ( this.options.server ) {
      this.options.server.call(msg, function(error, success) {
        var response = error || success;
        if(response) {
          utils.JSON.stringify(response, self.options, function(err, body) {
            if (err) {
              return respondError(err);
            }
            conn.send(body);
          });
        }
        else {
          // no response received at all, must be a notification
        }
      });
    }
  }
}

WebSocketClient.prototype._resolvePending = function(err) {
  const reqIds = Object.keys(this.pendingReq);
  var elt;
  var id;
  // Deliver callback for all pending request
  while ( reqIds.length > 0 ) {
    id = reqIds.shift();
    this.pendingReq[id].callback(err);
    delete this.pendingReq[id];
  };

  while ( this.reqQueue.length > 0 ) {
    elt = this.reqQueue.shift();
    elt.callback(err);
  }
};

WebSocketClient.prototype.error = function(code, message, data) {
  if(typeof(code) !== 'number') {
    code = Server.errors.INTERNAL_ERROR;
  }

  if(typeof(message) !== 'string') {
    message = Server.errorMessages[code] || '';
  }

  var error = { code: code, message: message };
  if(typeof(data) !== 'undefined') {
    error.data = data;
  }
  return error;
};

WebSocketClient.prototype.attach = function(wsock, owns) {
  var error;
  // If a socket it already being used
  if ( this.wsock ) {
    error = this.error(Server.errors.INTERNAL_ERROR, "Cancelling pending requests");
    this._resolvePending(error);
    this.close(WSOCK_CLOSE_CODE, "Client closed connection");
  }
  this.options.ownsSock = owns ? true : false;
  this.wsock = wsock;
  this._addWebSocketHandlers(wsock);
}

WebSocketClient.prototype.close = function(code, reason) {
  // If we have manage the websocket AND one exists AND
  // it's in either the open or connecting state then ...
  if ( this.options.ownsSock && this.wsock &&
    ((this.wsock.readyState === WebSocket.OPEN) ||
    (this.wsock.readyState === WebSocket.CONNECTING)) ) {
    this.wsock.close(code, reason);
  }
}
