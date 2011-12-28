/*

Required Variables:

  graphiteHost:     hostname or IP of Graphite server
  graphitePort:     port of Graphite server
  port:             StatsD listening port [default: 8125]

Optional Variables:

  debug:            debug flag [default: false]
  debugInterval:    interval to print debug information [ms, default: 10000]
  dumpMessages:     log all incoming messages
  flushInterval:    interval (in ms) to flush to Graphite
  percentThreshold: for time information, calculate the Nth percentile
                    [%, default: 90]
patterns:
  all patterns are optional (default values are reasonable).
  patterns may contain special variables which are replaced by actual data:
    ${hostname} : will be replaced by the reversed hostname, if the hostname is www.example.com, the ${hostname} variable will be replaced by com.example.www
    ${key}      : key provided by client library

  stats_pattern:		pattern used when creating user data keys, for example servers.${hostname}.${key}
  stats_timers_pattern:	pattern used when creating timer keys, for example "servers.${hostname}.${key}_timers"
  statsd_pattern:		pattern used when creating keys used for statsd statistics, for example "servers.${hostname}.statsd.${key}"

*/

{
  graphitePort          : 2003
, graphiteHost : "carbon"
, port : 8125
, stats_pattern         : "servers.${hostname}.${key}"
, stats_timers_pattern  : "servers.${hostname}.timers.${key}"
, statsd_pattern        : "servers.${hostname}.statsd.${key}"
}
