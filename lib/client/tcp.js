var net = require('net');
var url = require('url');
var utils = require('../utils');
var Client = require('../client');

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
    socket: null,
    server: null
  });
  this.options = utils.merge(defaults, options || {});
  this.pendingReq = {};
  this.reqQueue = [];
  this.sock = options.socket;
  // If we're using a provided socket then we'll implicitly be
  // reusing that connection for all requests
  if ( this.options.socket ) {
    this.options.reuseConnection = true;
  }
};
require('util').inherits(ClientTcp, Client);

module.exports = ClientTcp;

ClientTcp.prototype._request = function(request, callback) {
  var self = this;
  // copies options so object can be modified in this context
  var options = utils.merge({}, this.options);
  var sock;

  function execute(conn) {
    var item;
    while ( self.reqQueue.length > 0 ) {
      item = self.reqQueue.shift();
      // Won't get anything for notifications, just end here
      if(utils.Request.isNotification(item.request)) {
        if ( options.reuseConnection ) {
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
    }
  }

  utils.JSON.stringify(request, options, function(err, body) {

    if(err) {
      return callback(err);
    }

    self.reqQueue.push({ request: request, callback: callback, body: body});
    if ( self.sock && !self.sock.connecting ) {
      execute(self.sock);
    }
    else if ( !self.sock ) {
      sock = net.connect(options, function() {
        sock.setEncoding(options.encoding);
        sock.on('error', function(err) {
          self.emit('tcp error', err);
          self._resolvePending(err);
        });
    
        sock.on('end', function() {
          self._resolvePending();
        });
        utils.parseStream(sock, options, self._onIncomingMessage.bind(self, sock));
        execute(sock);
      });
      if ( options.reuseConnection ) {
        self.sock = sock;
      }
    }
  });
};

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
    // If there is no JSON-RPC server associated with this client then ...
    if ( !self.options.server ) {
      if ( utils.Request.isNotification(msg) ) {
        self.emit('rx notification', msg);
      }
      else {
        self.emit('rx request', msg);
      }
    }
    // Else we have an associated server that will try to handle the request
    else {
      self.options.server.call(msg, function(error, success) {
        var response = error || success;
        if(response) {
          utils.JSON.stringify(response, options, function(jsonErr, body) {
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

ClientTcp.prototype._resolvePending = function(err) {
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

ClientTcp.prototype.end = function() {
  // If we didn't borrow this socket and it exits then ...
  if ( !this.options.socket && this.sock ) {
    this.sock.end();
  }
}
