localturk
=========

Local Turk implements Amazon's Mechanical Turk API on your own machine.

It's handy if you want to:

1. Develop a Mechanical Turk template
2. Do some repetitive tasks on your own, without involving Turkers.

You could use it, for instance, to generate test and training data for a Machine Learning algorithm.


Quick Start
-----------

Install:

    npm install -g localturk

Run:

    cd localturk/sample
    localturk --static_dir . transcribe.html tasks.csv outputs.csv

Then visit http://localhost:4321/ to start Turking.


Templates and Tasks
-------------------

Using Local Turk is just like using Amazon's Mechanical Turk. You create:

1. An HTML template file with a &lt;form&gt;
2. A CSV file of tasks

For example, say you wanted to record whether some images contained a red ball. You would make a CSV file containing the URLs for each image:

    image_url
    http://example.com/image_with_red_ball.png
    http://example.com/image_without_red_ball.png

Then you'd make an HTML template for the task:

```html
<img src="${image_url}" />
<input type=radio name=has_button value="yes" /> Has a red ball<br/>
<input type=radio name=has_button value="no" /> Does not have a red ball<br/>
```

Finally, you'd start up the Local Turk server:

    $ localturk path/to/template.html path/to/tasks.csv path/to/output.csv

Now you can visit http://localhost:4321/ to complete each task. When you're done, the output.csv file will contain

    image_url,has_button
    http://example.com/image_with_red_ball.png,yes
    http://example.com/image_without_red_ball.png,no

Image Classification
--------------------

The use case described above (classifying images) is an extremely common one.

To expedite this, localturk provides a separate script for doing image
classification. The example above could be written as:


    classify-images --labels 'Has a red ball,Does not have a red ball' *.png

This will bring up a web server with a UI for assigning one of those two labels
to each image on your local file system. The results will go in `output.csv`.

For more details, run `classify-images --help`.

Batching
--------

It is often desirable to represent several records on a page, and submit them all when done. Localturk supports this mode with an optional `--batch_size` switch.

First, you should define repeatable template by adding the following marker before and after the repeatable block:
```html
<!-- localturk-repeat -->
```
Inside repeatable block you can use a special meta name `${index}` that will take the value of the task index within the batch (rarely needed).

If `localturk-repeat` marker is not found, the whole template will be repeated.

Finally, you need to start `localturk` giving it `--batch_size` parameter of `2` or greater.

See example of batching in `sample_batch/` directory.
