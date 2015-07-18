var config = require('./config.json');
var request = require('request');


function log(message) {
    console.log((new Date).toISOString().replace(/z|t/gi,' ').substring(0, 19)
		+ " : " + message);
}

log("Launching Watchit!");
log("Mandrill API Key: " + config.mandrillKey);

function Dispatcher(watchers) {
    var _lock = false;
    var _queue = 0;

    var _watcherMap = {};
    watchers.forEach(function(watcher) {
	_watcherMap[watcher.subreddit] = watcher;
    });
    
    var scheduleInitialDispatch = function(subreddit) {
	log('Scheduling dispatch for ' + subreddit);
	setTimeout(function() { dispatch(subreddit) },
		   _watcherMap[subreddit].interval);
    };

    var delayDispatch = function(subreddit) {
	setTimeout(function() { dispatch(subreddit) },
		   2000 * _queue);
    };

    var dispatch = function(subreddit) {
	if(!_lock) {
	    _lock = true;
	    _watcherMap[subreddit].checkSubreddit();

	    if(_queue > 0) queue--;
	    setTimeout(function() {
		_lock = false;
	    }, 2000);
	    
	} else {
	    queue++;
	    delayDispatch(subreddit);
	}
    };

    this.start = function() {
	for(var subreddit in _watcherMap) {
	    if (_watcherMap.hasOwnProperty(subreddit)) {
		scheduleInitialDispatch(subreddit);
	    }
	}	
    };
};

function Watcher(configWatcher) {
    this.subreddit = configWatcher.subreddit;
    this.email = configWatcher.email;
    this.interval = configWatcher.interval;
    this.maxFailures = configWatcher.alertOnFailures;
    this.oldPosts = [];
};

Watcher.prototype.checkSubreddit = function () {
    log('Watcher /r/' + this.subreddit + ' is checking for new posts...');
    request({ 'url': 'https://reddit.com/r/' + this.subreddit + '/new.json' },
	    (function(error, response, body) {
		if (!error && response.statusCode == 200) {

		    //Take all posts and turn them into redditPost objects
		    var loadedPosts = JSON.parse(body).data.children.map(function (post) {
			return new redditPost(post);
		    });
		    
		    //Step through each post from the loadedPosts and compare with oldPosts
		    //Since listings are sorted by submission date, we can stop as soon as an old post is seen
		    var newPosts = [];
		    for(var k = 0; k < loadedPosts.length; k++) {
			if(!loadedPosts[k].equals.call(this, this.oldPosts[0]))
			    newPosts.push(loadedPosts[k])
			else
			    break;
		    }
		    
		    var message = this.composeEmail.call(this, newPosts);
		    this.sendEmail.call(this, this.email.subject
				   .replace('[subreddit]', this.subreddit),
				   message);
		    
		} else {
		    log("Subreddit " + this.subreddit + " read failure!");
		    log("error" + JSON.stringify(error));
		    log("response" + JSON.stringify(response));
		    log("body" + JSON.stringify(body));
		}
	    }).bind(this));
};

Watcher.prototype.composeEmail = function(posts) {
    var response = '';
    posts.forEach((function(post) {
	response += ('<p>' + this.email.body
		     .replace('[title]', post.title)
		     .replace('[url]', post.url)
		     .replace('[permalink]', post.permalink)
		     + '</p>');
    }).bind(this))
    return response;
};

Watcher.prototype.sendEmail = function (subject, body) {
    request({ 'url': 'https://mandrillapp.com/api/1.0/messages/send.json',
	  'method': 'POST',
	  'json': { 'key': config.mandrillKey,
		    'message': {
			'from_email': this.email.from,
			'to': [
			    {
				'email': this.email.to,
				'type': 'to'
			    }],
			'autotext': 'true',
			'subject': subject,
			'html': body,
		    }
		  }
	    }, (function(error, response, body) {
		if (!error && response.statusCode == 200) {
		    log("Alert Email by " + this.subreddit
			+ " successfully dispatched.");
		} else {
		    log("Alert Email by " + this.subreddit
			+ " Dispatch Error!");
		    log('error ' + JSON.stringify(error));
		    log('response ' + JSON.stringify(response));
		    log('body ' + JSON.stringify(body));
		}
	    }).bind(this));
};

function redditPost(rawPost) {
    rawPost = rawPost.data;
    this.domain = rawPost.domain;
    this.subreddit = rawPost.subreddit;
    this.url = rawPost.url;
    this.permalink = rawPost.permalink;
    this.title = rawPost.title;
    this.author = rawPost.author;
}

redditPost.prototype.equals = function(post) {
    if(!post)
	return false;
    return (this.permalink == post.permalink);
}    

function main() {
    var watchers = [];
    config.watchers.forEach(function(rawWatcher) {
	watchers.push(new Watcher(rawWatcher));
    });

    var Dispatch = new Dispatcher(watchers);
    Dispatch.start();
    log('Engaging Dispatcher...');
}

main();
