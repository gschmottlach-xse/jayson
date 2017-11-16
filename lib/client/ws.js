var net = require('net');
var url = require('url');
var utils = require('../utils');
var Client = require('../client');
var WebSocket = require('ws');
var Server = require('../server');

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

  if(!(this instanceof WebSocketClient)) {
    return new WebSocketClient(options);
  }
  Client.call(this, options);

  var defaults = utils.merge(this.options, {
    // Option to use an existing (open) websocket if provided
    wsock: null,
    server: null
  });
  this.options = utils.merge(defaults, options || {});
  this.pendingReq = {};
  this.reqQueue = [];
  this.wsock = this.options.wsock;
};
require('util').inherits(WebSocketClient, Client);

module.exports = WebSocketClient;

WebSocketClient.prototype._request = function(request, callback) {
  var self = this;
  // copies options so object can be modified in this context
  var options = utils.merge({}, this.options);
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

  utils.JSON.stringify(request, options, function(err, body) {

    if(err) {
      return callback(err);
    }

    self.reqQueue.push({ request: request, callback: callback, body: body});
    if ( self.wsock && (self.wsock.readyState === WebSocket.OPEN) ) {
      execute(self.wsock);
    }
    else if ( !self.wsock ) {
      wsock = new WebSocket(options.href || options.address, options);
      wsock.on('open', function() {
        wsock.on('error', function(err) {
          var error = self.error(Server.errors.INTERNAL_ERROR, null, String(err));
          self.emit('ws error', error);
          self._resolvePending(error);
        });
    
        wsock.on('close', function(code, reason) {
          self._resolvePending(self.error(Server.errors.INTERNAL_ERROR, String(reason), code));
        });
        wsock.on('message', function(data) {
          utils.JSON.parse(data, options, function(err, response) {
            // If there is no error parsing the JSON-RPC data then ...
            if(!err) {
              self._onIncomingMessage(wsock, response);
            }

            // If there was an error, then it means the message received wasn't
            // correctly formatted JSON. We drop it in the bit-bucket.
          });
        });
        execute(wsock);
      });
      self.wsock = wsock;
    }
  });
};


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
    // If there is no JSON-RPC server associated with this client then ...
    if ( !this.options.server ) {
      if ( utils.Request.isNotification(msg) ) {
        this.emit('rx notification', msg);
      }
      else {
        this.emit('rx request', msg);
      }
    }
    // Else we have an associated server that will try to handle the request
    else {
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

WebSocketClient.prototype.close = function(code, reason) {
  // If we have *not* borrowed a websocket AND one exists AND
  // it's in either the open or connecting state then ...
  if ( !this.options.wsock && this.wsock &&
    ((this.wsock.readyState === WebSocket.OPEN) ||
    (this.wsock.readyState === WebSocket.CONNECTING)) ) {
    this.wsock.close(code, reason);
  }
}
