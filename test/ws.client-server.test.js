var should = require('should');
var _ = require('lodash');
var jayson = require('./../');
var support = require('./support');
var suites = require('./support/suites');
var WebSocket = require('ws');
var url = require('url');
var JSONStream = require('JSONStream');

describe('jayson.ws', function() {

  describe('server', function() {

    var server = null;

    before(function(done) {
      server = jayson.server(support.server.methods, support.server.options).ws({host: 'localhost', port:3999});
      server.once('listening', function() {
        done();
      })
    });

    after(function(done) {
      server.close(function() {
        done();
      });
    });


    it('should be an instance of ws.Server', function() {
      server.should.be.instanceof(WebSocket.Server);
    });

    context('connected socket', function() {

      var socket = null;
      var responses = null;

      // beforeEach(function(done) {
      //   server.once('listening', function() {
      //     done();
      //   })
      // });

      beforeEach(function(done) {
        socket = new WebSocket('ws://localhost:3999');
        socket.on('open', function() {
          done();
        });
      });

      afterEach(function(done) {
        socket.close();
        done();
      });

      it('should send a parse error for invalid JSON data', function(done) {
        socket.on('message', function(data) {
          var resp = JSON.parse(data);
          resp.should.containDeep({
            id: null,
            error: {code: -32700} // Parse Error
          });
          done();
        });

        // obviously invalid
        socket.send('abc');
      });

      it('should send more than one reply on the same socket', function(done) {
        var replies = [];
        socket.on('message', function(data) {
          replies.push(JSON.parse(data));
        });

        // write raw requests to the socket
        socket.send(JSON.stringify(jayson.Utils.request('delay', [20])));
        socket.send(JSON.stringify(jayson.Utils.request('delay', [5])));

        setTimeout(function() {
          replies.should.have.lengthOf(2);
          replies[0].should.have.property('result', 5);
          replies[1].should.have.property('result', 20);
          done();
        }, 40);
      });
    
    });

  });

  describe('client', function() {

    var server = jayson.server(support.server.methods, support.server.options);
    var server_ws;
    var client = jayson.client.ws({
      reviver: support.server.options.reviver,
      replacer: support.server.options.replacer,
      href: 'ws://localhost:3999'
    });

    before(function(done) {
      server_ws = server.ws({host:'localhost', port:3999});
      server_ws.once('listening', function() {
        done();
      })
    });

    after(function(done) {
      server_ws.close(function() {
        done();
      });
    });

    describe('common tests', suites.getCommonForClient(client));

  });

  describe('client - performance test', function() {
    
    var server = jayson.server(support.server.methods, support.server.options);
    var server_ws;
    var client = jayson.client.ws({
      reviver: support.server.options.reviver,
      replacer: support.server.options.replacer,
      href: 'ws://localhost:3999'
    });

    before(function(done) {
      server_ws = server.ws({host:'localhost', port:3999});
      server_ws.once('listening', function() {
        done();
      })
    });

    after(function(done) {
      server_ws.close(function() {
        done();
      });
    });

    describe('extra tests', function() {
      it('add_slow', function(done) {
        var idx;
        var NUM_ITERATIONS = 20000;
        var count = 0;
        var item;

        function onResponse(data, err, error, result) {
          count++;
          should.exist(result);
          result.should.equal(data[0] + data[1]);
          if ( count === NUM_ITERATIONS ) {
            done();
          }
        }

        this.timeout(5 * 1000);
        for ( idx = 0; idx < NUM_ITERATIONS; ++idx ) {
          item = [ _.random(1000),
                    _.random(1000),
                    idx % 4 === 0 ? true : false ];
          client.request('add_slow', item, onResponse.bind(this, item));
        }
      });
    });

  });

describe('client', function() {

    var server = jayson.server(support.server.methods, support.server.options);
    var server_ws;
    var client = jayson.client.ws({
      reviver: support.server.options.reviver,
      replacer: support.server.options.replacer,
      href: 'ws://localhost:3999'
    });

    before(function(done) {
      server_ws = server.ws({host:'localhost', port:3999});
      server_ws.once('listening', function() {
        done();
      })
    });

    after(function(done) {
      server_ws.close(function() {
        done();
      });
    });

    describe('common tests', suites.getCommonForClient(client));

  });

  describe('client - performance test', function() {
    
    var server = jayson.server(support.server.methods, support.server.options);
    var server_ws;
    var client = jayson.client.ws({
      reviver: support.server.options.reviver,
      replacer: support.server.options.replacer,
      href: 'ws://localhost:3999'
    });

    before(function(done) {
      server_ws = server.ws({host:'localhost', port:3999});
      server_ws.once('listening', function() {
        done();
      })
    });

    after(function(done) {
      server_ws.close(function() {
        done();
      });
    });

    describe('extra tests', function() {
      it('add_slow', function(done) {
        var idx;
        var NUM_ITERATIONS = 20000;
        var count = 0;
        var item;

        function onResponse(data, err, error, result) {
          count++;
          should.exist(result);
          result.should.equal(data[0] + data[1]);
          if ( count === NUM_ITERATIONS ) {
            done();
          }
        }

        this.timeout(5 * 1000);
        for ( idx = 0; idx < NUM_ITERATIONS; ++idx ) {
          item = item = [ _.random(1000),
                          _.random(1000),
                          idx % 4 === 0 ? true : false ];
          client.request('add_slow', item, onResponse.bind(this, item));
        }
      });
    });

  });

  describe('client/server share connection', function() {
    var serverMethods = {
      multiply: function(a, b, callback) {
        this.client.request('multiply', [a, b], function(err, resp) {
          if (err) {
            callback(err);
          }
          else {
            callback(null, resp.result);
          }
        });
      },

      multiply_slow: function(a, b, isSlow, callback) {
        this.client.request('multiply_slow', [a, b, isSlow], function(err, resp) {
          if (err) {
            callback(err);
          }
          else {
            callback(null, resp.result);
          }
        });
      },

      error: function(arg, callback) {
        this.client.request('error', [arg], function(err, resp) {
          if (err) {
            callback(err);
          }
          else {
            callback(resp.error);
          }
        });
      },

      notify: function(message, callback) {
        this.client.request('notify', [ message ], null, function(err) {
          if (err) {
            throw(err);
          }
        });
      }
    };

    var clientMethods = {
      multiply: function(a, b, callback) {
        var result = a * b;
        callback(null, result);
      },

      multiply_slow: function(a, b, isSlow, callback) {
        var result = a * b;
        if ( isSlow ) {
          setTimeout(function() {
            callback(null, result);
          }, 20);
        }
        else {
          callback(null, result);
        }
      },

      error: function(arg, callback) {
        callback(this.error(-1000, 'An error message'));
      },

      notify: function(message, callback) {
        notifyMsg = message;
        callback();
      }
    };

    var serverOpts = { collect: false };
    var serverApi = jayson.server(serverMethods, serverOpts);
    var server_ws;
    var notifyMsg;
    var clientOpts = { collect: false };
    var clientApi = jayson.server(clientMethods, clientOpts);
    var client_ws = jayson.client.ws({
      href: 'ws://localhost:3999',
      server: clientApi
    });


    before(function(done) {
      server_ws = serverApi.ws({host:'localhost', port:3999});
      server_ws.once('listening', function() {
        done();
      });
      server_ws.once('connection', function(wsock) {
        serverApi.client = jayson.client.ws({ wsock : wsock });
      });
    });

    after(function(done) {
      server_ws.close(function() {
        notifyMsg = null;
        done();
      });
    });

    describe('test client API', function() {
      it('multiply_slow', function(done) {
        var idx;
        var NUM_ITERATIONS = 5000;
        var count = 0;
        var item;

        function onResponse(data, err, error, result) {
          count++;
          should.exist(result);
          result.should.equal(data[0] * data[1]);
          if ( count === NUM_ITERATIONS ) {
            done();
          }
        }

        this.timeout(5 * 1000);
        for ( idx = 0; idx < NUM_ITERATIONS; ++idx ) {
          item = [ _.random(1000),
                    _.random(1000),
                    idx % 4 === 0 ? true : false ];
          client_ws.request('multiply_slow', item, onResponse.bind(this, item));
        }
      });

      it('multiply', function(done) {
        var idx;
        var NUM_ITERATIONS = 5000;
        var count = 0;
        var item;

        function onResponse(data, err, error, result) {
          count++;
          should.exist(result);
          result.should.equal(data[0] * data[1]);
          if ( count === NUM_ITERATIONS ) {
            done();
          }
        }

        this.timeout(5 * 1000);
        for ( idx = 0; idx < NUM_ITERATIONS; ++idx ) {
          item = [ _.random(1000),
                  _.random(1000) ];
          client_ws.request('multiply', item, onResponse.bind(this, item));
        }
      });

      it('error', function(done) {
        var idx;
        var count = 0;
        var item;

        client_ws.request('error', [5], function(err, resp) {
          resp.should.containDeep({
            error: {code: -1000, message: 'An error message' }
          });
          done();
        });
      });

      it('notify', function(done) {
        client_ws.request('notify', ['Hello'], null, function(err, resp) {
          setTimeout(function() {
            notifyMsg.should.equal('Hello');
            done();
          }, 50);
        });
      });

    });

  });
});
