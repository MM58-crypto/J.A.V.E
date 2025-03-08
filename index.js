const http = require('http')
// const express = require('express')
const fs = require('fs')
const url = require('url')
//const app = express();
const port = 3000;

let server = http.createServer(function(req, res) {

    // home
    if (req.url =='/') {
        fs.readFile('index.html', function(err, data) {
            if(err) {
                res.statusCode = 404
                res.setHeader('Content-Type', 'text/html')
                return res.end('<h1> 404, Page not found </h1>')
            }
            else {
                res.statusCode = 200
                res.setHeader('Content-Type', 'text/html')
                res.write(data);
                return res.end();
            }
        });
    }

})
// smtp

server.listen(port, () => console.log('Server listening on port ' + port ));
