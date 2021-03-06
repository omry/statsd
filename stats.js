var dgram  = require('dgram')
  , sys    = require('util')
  , net    = require('net')
  , config = require('./config')

var counters = {};
var timers = {};
var gauges = {};
var debugInt, flushInt, server, mgmtServer;
var startup_time = Math.round(new Date().getTime() / 1000);
var hostname = require("os").hostname().split(".").reverse().join(".");

var stats = {
  graphite: {
    last_flush: startup_time,
    last_exception: startup_time
  },
  messages: {
    last_msg_seen: startup_time,
    bad_lines_seen: 0,
  }
};

function create_key(pattern, key)
{
    tmp = pattern.replace("${hostname}",hostname)
    tmp = tmp.replace("${key}", key)
    return tmp
}

config.configFile(process.argv[2], function (config, oldConfig) {
  if (! config.debug && debugInt) {
    clearInterval(debugInt); 
    debugInt = false;
  }

  if (config.debug) {
    if (debugInt !== undefined) { clearInterval(debugInt); }
    debugInt = setInterval(function () { 
      sys.log("Counters:\n" + sys.inspect(counters) +
	      "\nTimers:\n" + sys.inspect(timers) +
	      "\nGauges:\n" + sys.inspect(gauges));
    }, config.debugInterval || 10000);
  }

  var stats_pattern         = config.stats_pattern          || "stats.${key}";
  var statsd_pattern        = config.statsd_pattern         || "statsd.${key}";
  var stats_timers_pattern  = config.stats_timers_pattern   || "stats.timers.${key}";
  if (stats_pattern.indexOf("${key}") == -1) throw "missing ${key} in pattern";
  if (stats_timers_pattern.indexOf("${key}") == -1) throw "missing ${key} in pattern";
  if (statsd_pattern.indexOf("${key}") == -1) throw "missing ${key} in pattern";

  var flushInterval = Number(config.flushInterval || 10000);
  sys.log("flush interval " + flushInterval);
  var gaugeBuckets = flushInterval / 10000
  sys.log("gauge buckets " + gaugeBuckets);

  if (server === undefined) {
    server = dgram.createSocket('udp4', function (msg, rinfo) {
      if (config.dumpMessages) { sys.log(msg.toString()); }
      var bits = msg.toString().split(':');
      var key = bits.shift()
                    .replace(/\s+/g, '_')
                    .replace(/\//g, '-')
                    .replace(/[^a-zA-Z_\-0-9\.]/g, '');

      if (bits.length == 0) {
        bits.push("1");
      }

      for (var i = 0; i < bits.length; i++) {
        var sampleRate = 1;
        var fields = bits[i].split("|");
        if (fields[1] === undefined) {
            sys.log('Bad line: ' + fields);
            stats['messages']['bad_lines_seen']++;
            continue;
        }
        if (fields[1].trim() == "ms") {
          if (! timers[key]) {
            timers[key] = [];
          }
          timers[key].push(Number(fields[0] || 0));
        } else if(fields[1].trim() == "g") {
          if (!gauges[key]) {
			  gauges[key] = new Array(gaugeBuckets);
          }
   		  var sec = new Date().getSeconds()
		  if (fields[0]){
			  var idx = Math.floor((sec / 60.0) * gaugeBuckets);
			  //sys.log("gauge index " + sec + " -> " + idx);
			  gauges[key][idx] = parseFloat(fields[0])
		  }
        }
	else {
          if (fields[2] && fields[2].match(/^@([\d\.]+)/)) {
            sampleRate = Number(fields[2].match(/^@([\d\.]+)/)[1]);
          }
          if (! counters[key]) {
            counters[key] = 0;
          }
		  var num = Number(fields[0] || 1) * (1 / sampleRate);
	      counters[key] += num;
        }
      }

      stats['messages']['last_msg_seen'] = Math.round(new Date().getTime() / 1000);
    });

    mgmtServer = net.createServer(function(stream) {
      stream.setEncoding('ascii');

      stream.on('data', function(data) {
        var cmd = data.trim();

        switch(cmd) {
          case "help":
            stream.write("Commands: stats, counters, timers, gauges, quit\n\n");
            break;

          case "stats":
            var now    = Math.round(new Date().getTime() / 1000);
            var uptime = now - startup_time;

            stream.write("uptime: " + uptime + "\n");

            for (group in stats) {
              for (metric in stats[group]) {
                var val;

                if (metric.match("^last_")) {
                  val = now - stats[group][metric];
                }
                else {
                  val = stats[group][metric];
                }

                stream.write(group + "." + metric + ": " + val + "\n");
              }
            }
            stream.write("END\n\n");
            break;

          case "counters":
            stream.write(sys.inspect(counters) + "\n");
            stream.write("END\n\n");
            break;

          case "timers":
            stream.write(sys.inspect(timers) + "\n");
            stream.write("END\n\n");
            break;

          case "gauges":
            stream.write(sys.inspect(gauges) + "\n");
            stream.write("END\n\n");
            break;
          case "quit":
            stream.end();
            break;

          default:
            stream.write("ERROR\n");
            break;
        }

      });
    });

	var port = config.port || 8125
	var mgmt_port = config.mgmt_port || 8126
	sys.log("Binding to port " + port + ", management port " + mgmt_port)
    server.bind(port);
    mgmtServer.listen(mgmt_port);

    flushInt = setInterval(function () {
      var statString = '';
      var ts = Math.round(new Date().getTime() / 1000);
      var numStats = 0;
      var key;

      for (key in counters) {
        var value = counters[key] / (flushInterval / 1000);
        var message = create_key(stats_pattern, key) 	   + ' ' + value + ' ' + ts + "\n";
        statString += message;
        counters[key] = 0;

        numStats += 1;
      }

      for (key in gauges) {
        var g = gauges[key];
		if (g.length > 0){
			var sum = 0;
			var num = 0;
			for(var i=0;i<g.length;i++){
				// this is important, if there is no sample in the bucket, don't increase the num
				if (g[i] !=undefined){
					sum += g[i]
					num++
				}
			}

			if (num > 0){
				var avg = sum / num;
				numStats += 1;
				var message = create_key(stats_pattern, key) + ' ' + avg + ' ' + ts + "\n";
				statString += message;
			}
			delete gauges[key]
		}
      }

      for (key in timers) {
        if (timers[key].length > 0) {
          var pctThreshold = config.percentThreshold || 90;
          var values = timers[key].sort(function (a,b) { return a-b; });
          var count = values.length;
          var min = values[0];
          var max = values[count - 1];

          var mean = min;
          var maxAtThreshold = max;

          if (count > 1) {
            var thresholdIndex = Math.round(((100 - pctThreshold) / 100) * count);
            var numInThreshold = count - thresholdIndex;
            values = values.slice(0, numInThreshold);
            maxAtThreshold = values[numInThreshold - 1];

            // average the remaining timings
            var sum = 0;
            for (var i = 0; i < numInThreshold; i++) {
              sum += values[i];
            }

            mean = sum / numInThreshold;
          }

          timers[key] = [];

          var message = "";
          message += create_key(stats_timers_pattern, key) + '.mean ' + mean + ' ' + ts + "\n";
          message += create_key(stats_timers_pattern ,key) + '.upper ' + max + ' ' + ts + "\n";
          message += create_key(stats_timers_pattern ,key) + '.upper_' + pctThreshold + ' ' + maxAtThreshold + ' ' + ts + "\n";
          message += create_key(stats_timers_pattern ,key) + '.lower ' + min + ' ' + ts + "\n";
          message += create_key(stats_timers_pattern ,key) + '.count ' + count + ' ' + ts + "\n";
          statString += message;

          numStats += 1;
        }
      }

      statString += create_key(statsd_pattern,"numStats") + ' ' + numStats + ' ' + ts + "\n";
      try {
        var graphite = net.createConnection(config.graphitePort, config.graphiteHost);
        graphite.addListener('error', function(connectionException){
          if (config.debug) {
            sys.log(connectionException);
          }
        });
        graphite.on('connect', function() {
          this.write(statString);
          this.end();
          stats['graphite']['last_flush'] = Math.round(new Date().getTime() / 1000);
        });
      } catch(e){
        if (config.debug) {
          sys.log(e);
        }
        stats['graphite']['last_exception'] = Math.round(new Date().getTime() / 1000);
      }

    }, flushInterval);
  }

});

