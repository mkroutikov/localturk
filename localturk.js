#!/usr/bin/env node

// "Local Turk" server for running Mechanical Turk-like tasks locally.
//
// Usage:
// node localturk.js template.html tasks.csv outputs.csv

var assert = require('assert'),
    csv = require('csv'),
    fs = require('fs'),
    http = require('http'),
    express = require('express'),
    bodyParser = require('body-parser'),
    errorhandler = require('errorhandler'),
    path = require('path'),
    program = require('commander'),
    open = require('open')
    ;

program
  .version('1.1.3')
  .usage('[options] template.html tasks.csv outputs.csv')
  .option('-s, --static_dir <dir>', 'Serve static content from this directory')
  .option('-p, --port <n>', 'Run on this port (default 4321)', parseInt)
  .option('-b, --batch_size <n>', 'Batch <n> records per page (default 1)', parseInt)
  .option('-q, --quit_on_done', 'Quit when done with all tasks.')
  .parse(process.argv);

var args = program.args;
if (3 != args.length) {
  program.help();
}

var template_file = args[0],
    tasks_file = args[1],
    outputs_file = args[2];

var port = program.port || 4321,
    static_dir = program.static_dir || null,
    batch_size = program.batch_size || 1;

function readCsvFile(filename, cb) {
	var parser = csv.parse({columns: true, skip_empty_lines: true});
	var records = [];
	
	parser.on('readable', function() {
		var record;
		
		while (record = parser.read()) {
			records.push(record);
		}
	}).on('error', function(err) {
		cb(arr);
	}).on('finish', function() {
		if (parser.options.columns === true) {
			// zero-length file, no columns!
			cb(null, []);
		} else {
			console.log('read', records.length, 'records');
			cb(null, records, parser.options.columns);
		}
	});
	
	console.log('Reading ' + filename);

	fs.createReadStream(filename).pipe(parser);
}

function writeCsvFile(filename, records, columns, append, cb) {
	var stringifier = csv.stringify({columns: columns, header: !append});
	
	stringifier.on('error', function(err) {
		cb(err);
	}).on('end', function() {
		cb();
	});
	
	stringifier.pipe(fs.createWriteStream(filename, {flags: append ? 'a' : 'w'}));
	
	records.forEach(function(record) {
		stringifier.write(record);
	});
	
	stringifier.end();
}

function appendableCsvFile(filename, cb) {
	if (!fs.existsSync(filename)) {
		fs.writeFileSync(filename, '');
	}
	
	readCsvFile(filename, function(err, records, columns) {
		if (err) return cb(err);

		columns = columns || [];

		var csvFile = { records: records, columns: columns};
		
		var columnSet = {};
		columns.forEach(function(col) {
			columnSet[col] = true;
		});
		
		csvFile.append = function(newRecords, callback) {
			var needRebuild = false;
			
			newRecords.forEach(function(record) {
				for (var col in record) {
					if (!columnSet[col]) {
						needRebuild = true;
						columns.push(col);
						columnSet[col] = true;
					}
				}
			});
			
			newRecords.forEach(function(record) {
				records.push(record);
			});
			
			if(needRebuild) {
				writeCsvFile(filename, records, columns, false, callback);
			} else {
				writeCsvFile(filename, newRecords, columns, true, callback);
			}
		}
		
		cb(null, csvFile);
	});
}

function createWorkflow(taskFilename, outputFilename, cb) {
	readCsvFile(taskFilename, function(err, tasks, columns) {
		if (err) return cb(arr);
		
		appendableCsvFile(outputFilename, function(err, csvFile) {
			if (err) return cb(err);
			
			var tasksTodo = tasks;
			var tasksDone = csvFile.records;
			
			var workflow = {
					tasks: tasks,
					finished: csvFile.records
			};
			workflow.hasMore = function() {
				return tasksDone.length < tasksTodo.length;
			};
			
			workflow.nextBatch = function(batchSize) {
				batchSize = batchSize || 1;
				if (tasksTodo.length - tasksDone.length < batchSize) {
					batchSize = tasksTodo.length - tasksDone.length; 
				}
				if (batchSize <= 0) {
					return [];
				}
				
				return tasksTodo.slice(tasksDone.length, tasksDone.length + batchSize);
			}
			
			workflow.writeCompletedBatch = csvFile.append;
			
			cb(null, workflow);
		});
	});
}

function htmlEntities(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parseTemplate(filename) {
	var data = fs.readFileSync(filename).toString('utf-8');
	
	var parts = data.split(/<!--\s*localturk-repeat\s*-->/ig);
	var head = '', tail = '', repeat = data;
	
	if (parts.length === 1) {
	} else if (parts.length !== 3) {
		throw Exception('failed to parse localturk repeat markers - too many or too few of them?');
	} else {
		head = parts[0];
		repeat = parts[1];
		tail = parts[2];
	}
	
	// lets inject ${index} into any named <input> elements in the repeat block
	var re = /<input\s+([^>]+)\/?>/g;
	var out = [];
	var offset = 0;
	
	while (true) {
			var result = re.exec(repeat);
			if (!result) break;

			re.index = result.index;

			var inp = result[0];

			out.push(repeat.slice(offset, result.index));
			offset = result.index + inp.length;
			
			var match = /name="([^"]+)"/.exec(inp);
			if (match) {
				out.push(inp.slice(0, match.index));
				out.push('name="' + match[1] + '__${index}' + '"');
				out.push(inp.slice(match.index + match[0].length));
			} else {
				out.push(inp);
			}
	}
	
	out.push(repeat.slice(offset));
	
	repeat = out.join('');
	
	return {
		head: head,
		repeat: repeat,
		tail: tail
	};
}

var template = parseTemplate(template_file);

// Reads the template file and instantiates it with the task dictionary.
// Fires ready_cb(null, instantiated template) on success, or with an error.
function renderTasks(template, tasks) {
	var out = [template.head];
	
	for (var index = 0; index < tasks.length; index++) {
	    var t = template.repeat;
	    var task = tasks[index];
	    
	    for (var k in task) {
	    	t = t.replace('${' + k + '}', htmlEntities(task[k] || ''));
	    }
	    
	    t = t.replace('${index}', '' + index);

	    for (var k in task) {
	    	t += "<input type=hidden name='" + k + "__" + index + "' value=\"" + htmlEntities(task[k] || '') + "\" />";    	
	    }
	    
	    out.push(t);
	}
	
	out.push(template.tail);

    return out.join('');
}

function parseTasks(form) {
	// var names are either numbered (suffix like __23) or simple. Simple ones will be applicable to all numbers in the array
	var by_index = {};
	var unindexed = {};
	var num_tasks = 0;
	
	for (var k in form) {
		var match = /(.+)__(\d+)/.exec(k);
		console.log(k, match);
		if (match) {
			num_tasks = Math.max(num_tasks, 1+parseInt(match[2]));
			by_index[match[2]] = by_index[match[2]] || {};
			by_index[match[2]][match[1]] = form[k];
		} else {
			unindexed[k] = form[k];
		}
	}
	
	console.log(by_index, unindexed, num_tasks);
	
	var tasks = [];
	for (var i = 0; i < num_tasks; i++) {
		var task = {};
		
		for (var k in unindexed) {
			task[k] = unindexed[k];
		}
		
		var indexed = by_index['' + i] || {};
		for (var k in indexed) {
			task[k] = indexed[k];
		}
		
		tasks.push(task);
	}
	
	return tasks;
}

createWorkflow(tasks_file, outputs_file, function(err, workflow) {
	// --- begin server ---
	var app = express();
	app.use(bodyParser.urlencoded({extended: false}))
	app.set('views', __dirname);
	app.set("view options", {layout: false});
	app.use(errorhandler({
	    dumpExceptions:true,
	    showStack:true
	}));
	if (static_dir) {
	  app.use(express.static(path.resolve(static_dir)));
	}

	app.get("/", function(req, res) {
		batch = workflow.nextBatch(batch_size);
		if (batch.length === 0) {
			res.send('DONE');
			if (program.quit_on_done) {
				process.exit(0);
			}
		} else {
		      var out = "<!doctype html><html><body><form action=/submit method=post>\n";
		      out += '<p>Completed: ' + workflow.finished.length + ' / ' + workflow.tasks.length + '</p>\n';
			  out += renderTasks(template, batch);
		      out += '<hr/><input type=submit />\n';
		      out += "</form></body></html>\n";

		      res.send(out);
		}
	});
	
	app.post("/submit", function(req, res) {
		var tasks = parseTasks(req.body);
		workflow.writeCompletedBatch(tasks, function(err) {
		    if (err) {
				console.log('ERROR:', err);
				return res.send('ERROR, see console');
			}
		    console.log('Saved ' + JSON.stringify(tasks));
			res.redirect('/');
		});
	});

	app.listen(port);
	console.log('Running local turk on http://localhost:' + port)
	open('http://localhost:' + port + '/');
});
