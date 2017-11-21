var net = require('net');
var url = require('url');
var utils = require('../utils');
var Client = require('../client');
var Server = require('../server');

/**
 *  Constructor for a Jayson TCP Client
 *  @class ClientTcp
 *  @constructor
 *  @extends Client
 *  @param {Object|String} [options] Optional hash of settings or a URL
 *  @return {ClientTcp}
 */
var ClientTcp = function(options) {
  // accept first parameter as a url string
  if(typeof(options) === 'string') {
    options = url.parse(options);
  }

  if(!(this instanceof ClientTcp)) {
    return new ClientTcp(options);
  }
  Client.call(this, options);

  var defaults = utils.merge(this.options, {
    encoding: 'utf8',
    reuseConnection: false,
    // Option to use an existing (open) socket if provided
    socket: null,
    // Whether or not this client owns and manages the socket
    // (optionally) passed in.
    ownsSock: false,
    // The (optional) client-side JSON-RPC server handling
    // bi-directional peer-to-peer requests from the remote
    // server.
    server: null
  });
  this.options = utils.merge(defaults, options || {});
  this.pendingReq = {};
  this.reqQueue = [];
  this.sock = options.socket;
  // If we're using a provided socket then we'll implicitly be
  // reusing that connection for all requests
  if ( this.sock ) {
    this.options.reuseConnection = true;
    this._addSocketHandlers(this.sock);
  }
};
require('util').inherits(ClientTcp, Client);

module.exports = ClientTcp;

ClientTcp.prototype._request = function(request, callback) {
  var self = this;
  var sock;

  function execute(conn) {
    var item;

    while ( self.reqQueue.length > 0 ) {
      item = self.reqQueue.shift();
      // Won't get anything for notifications, just end here
      if(utils.Request.isNotification(item.request)) {
        if ( self.options.reuseConnection ) {
          conn.write(item.body);
        }
        else {
          conn.end(item.body);
        }
        item.callback();
      }
      else {
        // Keep track of pending requests
        self.pendingReq[item.request.id] = item;
        // Issue the request
        conn.write(item.body);
      }

      // If we're not re-using the connection then we only
      // send one message per connection.
      if ( !self.options.reuseConnection ) {
        break;
      }
    }
  }

  utils.JSON.stringify(request, this.options, function(err, body) {
    var reqItem;
    if(err) {
      return callback(err);
    }

    reqItem = { request: request, callback: callback, body: body };
    self.reqQueue.push(reqItem);
    if ( self.sock && !self.sock.connecting ) {
      // Update with it's associated socket
      reqItem.sock = self.sock;
      execute(self.sock);
    }
    else if ( !self.sock ) {
      sock = net.connect(self.options, function() {
        self.options.ownsSock = true;
        sock.setEncoding(self.options.encoding);
        self._addSocketHandlers(sock);
        execute(sock);
      });
      // Update with it's associated socket
      reqItem.sock = sock;

      if ( self.options.reuseConnection ) {
        self.sock = sock;
      }
    }
  });
};

ClientTcp.prototype._addSocketHandlers = function(sock) {
  this.sockErrorHandler = this._onSocketError.bind(this, sock);
  sock.on('error', this.sockErrorHandler);

  this.sockEndHandler = this._onSocketEnd.bind(this, sock);
  sock.once('end', this.sockEndHandler);

  this.sockMessageHandler = this._onIncomingMessage.bind(this, sock);
  utils.parseStream(sock, this.options, this.sockMessageHandler);
}

ClientTcp.prototype._onSocketError = function(sock, err) {
  var error = this.error(Server.errors.INTERNAL_ERROR, null, String(err));
  this.emit('tcp error', error);
  this._resolvePending(sock, error);
}

ClientTcp.prototype._onSocketEnd = function(sock) {
  this._resolvePending(sock, this.error(Server.errors.INTERNAL_ERROR, 'Socket ended'));
}

ClientTcp.prototype._onIncomingMessage = function(conn, err, msg) {
  // Look up the matching request
  var self = this;
  var item = err ? null : self.pendingReq[msg.id];

  // Ends the request with an error code
  function respondError(rspErr) {
    var error = self.error(Server.errors.PARSE_ERROR, null, String(rspErr));
    var response = utils.response(error, undefined, undefined, self.options.version);
    utils.JSON.stringify(response, options, function(jsonErr, body) {
      if(jsonErr) {
        body = ''; // we tried our best.
      }
      conn.write(body);
    });
  }

  // If we're not reusing a connection then end this one
  if ( !self.options.reuseConnection ) {
    conn.end();
  }
  // If we found the matching request
  if ( item ) {
    // Remove it from the collection of pending requests
    delete self.pendingReq[msg.id];
    if(err) {
      return item.callback(err);
    }
    item.callback(null, msg);
  }
  // Else if a request from the remote end then ...
  else if ( utils.Request.isValidRequest(msg, self.options.version) ) {
    // If there is a JSON-RPC server associated with this client then ...
    if ( self.options.server ) {
      self.options.server.call(msg, function(error, success) {
        var response = error || success;
        if(response) {
          utils.JSON.stringify(response, self.options, function(jsonErr, body) {
            if (jsonErr) {
              return respondError(jsonErr);
            }
            conn.write(body);
          });
        }
        else {
          // no response received at all, must be a notification
        }
      });
    }
  }
};

ClientTcp.prototype._resolvePending = function(sock, err) {
  const reqIds = Object.keys(this.pendingReq);
  var id;
  var idx;

  // Deliver callback for all pending requests sent on the given socket
  while ( reqIds.length > 0 ) {
    id = reqIds.shift();
    if ( this.pendingReq[id].sock === sock ) {
      this.pendingReq[id].callback(err);
      delete this.pendingReq[id];
    }
  };

  // Remove any requests scheduled to be delivered over the given socket
  idx = this.reqQueue.length;
  while ( idx-- ) {
    if ( this.reqQueue[idx].sock === sock ) {
      this.reqQueue[idx].callback(err);
      this.reqQueue.splice(idx, 1);
    }
  }
};

ClientTcp.prototype.attach = function(sock, owns) {
  var error;
  // If a socket it already being used
  if ( this.sock ) {
    error = this.error(Server.errors.INTERNAL_ERROR, "Cancelling pending requests");
    this._resolvePending(sock, error);
    this.end();
  }
  this.options.ownsSock = owns ? true : false;
  this.sock = sock;
  this._addSocketHandlers(sock);
}

ClientTcp.prototype.error = function(code, message, data) {
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

ClientTcp.prototype.end = function() {
  // If we didn't borrow this socket and it exits then ...
  if ( this.options.ownsSock && this.sock ) {
    this.sock.end();
  }
}
