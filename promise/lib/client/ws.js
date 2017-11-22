var promisify = require('es6-promisify');
var jayson = require('../../../');

/**
 * Constructor for a Jayson Promise Client Websocket
 * @see Client
 * @class PromiseClientWs
 * @extends WebSocketClient
 * @return {PromiseClientWs}
 */
var PromiseClientWs = function(options) {
  if(!(this instanceof PromiseClientWs)) {
    return new PromiseClientWs(options);
  }
  jayson.Client.ws.apply(this, arguments);
  this.request = promisify(this.request);
};
require('util').inherits(PromiseClientWs, jayson.Client.ws);

module.exports = PromiseClientWs;
