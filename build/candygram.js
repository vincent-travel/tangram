// Candygram is a Tangram-specific Browserify plugin
// It stringifies the library code into a variable that is immediately eval'ed,
// that can then be reused when Tangram instantiates is worker threads.

var through = require('through2');
var execSync = require('child_process').execSync;
var jsesc = require('jsesc');
var uglify = require("uglify-js");
var fs = require('fs');

// export a Browserify plugin
module.exports = function (browserify, opts) {
    //  create a transform stream
    var createStream = function () {
        var code = '';
        var stream = through.obj(function (buf, enc, next) {
            // accumulate the code chunks
            code += buf.toString();
            next();
        }, function (next) {
            // transform the code when accumulated
            if (opts.minify) { // optionally minify the code first
                code = uglify.minify(code, { fromString: true }).code;
            }

            // escape the code with single quotes
            code = jsesc(code, { quotes: 'single', wrap: true });

            // save it to a variable and eval, then save to internal Tangram property for later access
            var out = '(function(){\n';
            out += 'var _TangramSource = ' + code + ';\n';
            out += 'var start = +new Date();\n';
            out += 'eval(_TangramSource);\n';
            out += 'var target = (typeof module !== "undefined" && module.exports) || (typeof window !== "undefined" && window.Tangram);\n';
            out += 'if (target && target.source) { target.source._source = _TangramSource; target.source._startTime = start; };\n';
            out += 'console.log("*** Tangram eval time: ", (+new Date()) - start);\n';
            out += '})();';

            this.push(new Buffer(out));
            next();
        });
        return stream;
    };

    // hook into the bundle generation pipeline of Browserify
    browserify.pipeline.get("wrap").push(createStream());
    browserify.on("reset", function () {
        browserify.pipeline.get("wrap").push(createStream());
    });
};
