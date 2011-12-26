var data_pattern  = "servers.${hostname}.${key}"
var hostname = require("os").hostname().split(".").reverse().join(".")

function create_key(pattern, key)
{
	tmp = pattern.replace("${hostname}",hostname)
	tmp = tmp.replace("${key}", key)
	return tmp
}

console.log(create_key(data_pattern, "hello.world"))
