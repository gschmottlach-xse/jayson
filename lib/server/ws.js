var WebSocket = require('ws');
var utils = require('../utils');
var Server = require('../server');
var _ = require('lodash');

/**
 *  Constructor for a Jayson WebSocket server
 *  @class WebSocketServer
 *  @extends WebSocket.Server
 *  @param {Server} server Jayson server instance
 *  @param {Object} [options] Options for this instance
 *  @return {ServerWebSocket}
 */
class WebSocketServer extends WebSocket.Server {
  constructor(server, options) {
    var self;

    // Call the baseclass constructor
    super(options);
    this.options = utils.merge(server.options, options || {});
    this.server = server;

    self = this;
    this.on('connection', function(wsock/*, req*/) {
      wsock.on('message', self.onIncomingMessage.bind(self, wsock));
    });
  }

  /**
   *  Handles inbound WebSocket messages
   *  @param {WebSocketServer} self Instance of WebSocketServer
   *  @param {WebSocket} wsock Instance of WebSocket
   *  @param {String} data Incoming message formatted in JSON.
   *  @return {undefined}
   *  @private
   *  @ignore
   */
  onIncomingMessage(wsock, data) {
    var options = this.options || {};
    var self = this;

    // Ends the request with an error code
    function respondError(err) {
      var error = self.server.error(Server.errors.PARSE_ERROR, null, String(err));
      var response = utils.response(error, undefined, undefined, self.options.version);
      utils.JSON.stringify(response, options, function(strErr, body) {
        if(strErr) {
          body = ''; // we tried our best.
        }
        wsock.send(body);
      });
    }

    utils.JSON.parse(data, options, function(err, msg) {
      var transport = {
        protocol: 'ws:',
        socket: wsock
      }
      if(err) {
        return respondError(err);
      }
      if ( utils.Request.isValidRequest(msg, options.version) || utils.Request.isBatch(msg) ) {
        self.server.call(data, function(error, success) {
          var response = error || success;
          if(response) {
            utils.JSON.stringify(response, options, function(jsonErr, body) {
              if(jsonErr) {
                return respondError(jsonErr);
              }
              wsock.send(body, function(sendErr) {
                if ( sendErr ) {
                  // console.error('Send failed: ' + sendErr);
                }
              });
            });
          } else {
            // no response received at all, must be a notification
          }
        }, transport);
      }
    });
  }

}

module.exports = function(server, options) {
  return new WebSocketServer(server, options);
};
