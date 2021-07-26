
// we have a problem here, validating the star-ssl cert on the live.pcgteam.net server
// therefore this ugly hack. Since we are triggering the call from server side, AND any
// client DID a successful validation on its end anyhow, its probably still safe enough.
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
console.log('WARN: SSL disabled by bob')

require("./realtime");
