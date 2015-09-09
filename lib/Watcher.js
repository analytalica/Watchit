var request = require('request');
var replaceAll = require('./stringReplaceAll.js');

//Classes
var RedditPost = require('./RedditPost.js');
var Filter = require('./Filter.js');

function Watcher(configWatcher, master) {
    //TODO: validate input
    this.master = master;
    this.subreddit = configWatcher.subreddit;
    this.email = configWatcher.emailTemplate;
    this.interval = (parseInt(configWatcher.interval)) >= 5000 ? parseInt(configWatcher.interval) : 60000;
    this.oldPosts = [];

    this.filters = [];
    if (Array.isArray(configWatcher.filters)) {
        this.filters = configWatcher.filters.map(function (filter) {
            return new Filter(filter);
        });
    }
    this.log('This subreddit has ' + this.filters.length + ' filters.');
}

Watcher.prototype.checkSubreddit = function (callback) {
    this.log('Checking for new posts...');
    request({'url': 'https://reddit.com/r/' + this.subreddit + '/new.json'},
        (function (error, response, body) {
            if (!error && response.statusCode == 200) {

                //Take all posts and turn them into RedditPost objects
                var loadedPosts = JSON.parse(body).data.children.map(function (post) {
                    return new RedditPost(post);
                });
                this.log('' + loadedPosts.length + ' posts loaded.');

                var filteredPosts = this.filterPosts(loadedPosts);
                var newPosts = this.selectNewPostsFrom(filteredPosts);
                this.log(newPosts.length + ' filtered posts are new.');

                if (newPosts.length > 0) {
                    this.log(newPosts[0].ageString + ' is the age of the newest filtered post.');
                    var replacements = {};
                    replacements['{subreddit}'] = this.subreddit;
                    replacements['{count}'] = newPosts.length;
                    replacements['{titles}'] = (newPosts.map(function (post) {
                        return post.title;
                    })).join(', ');

                    var message = replaceAll(this.composeEmail(newPosts), replacements);
                    var subject = replaceAll(this.email.subject, replacements);
                    this.sendEmail(subject, message);
                }

                this.oldPosts = loadedPosts;

            } else {
                this.log('Reddit read failure!');
                this.log('Error: ' + JSON.stringify(error));
                this.log('Response: ' + JSON.stringify(response), 1);
                this.log('Body: ' + JSON.stringify(body));
            }

            callback();
        }).bind(this));
};

Watcher.prototype.filterPosts = function(posts) {
    return posts.filter((function (post) {

        var filterCount = this.filters.length;
        //At least one filter must pass
        if (filterCount > 0) {
            for (var u = 0; u < filterCount; u++) {
                if (this.filters[u].test(post)) return true;
            }
            return false;
        }

        //If no filters are defined, let all posts pass
        return true;
    }).bind(this));
};

Watcher.prototype.selectNewPostsFrom = function(posts) {
    //Step through each post and compare with oldPosts
    //Since listings are sorted by submission date, we can stop as soon as an old post is seen
    var newPosts = [];
    for (var k = 0; k < posts.length; k++) {
        if (!posts[k].equals(this.oldPosts[0])) {
            newPosts.push(posts[k])
        } else {
            //When we reach a matching post, we know the rest of the posts will match
            //This works because posts are sorted by age
            break;
        }
    }
    return newPosts;
};

Watcher.prototype.composeEmail = function (posts) {
    var body = this.email.body;
    var bodyPosts = '';

    for (var i = 0; i < posts.length; i++) {
        var post = posts[i];

        //Any post property saved should be substituted in the template
        var postReplacements = {};
        for (var prop in post) {
            if(post.hasOwnProperty(prop)) {
                var value = post[prop];
                //Skip functions
                if (Object.prototype.toString.call(value) != '[object Function]')
                    postReplacements['{' + prop.toLowerCase() + '}'] = post[prop];
            }
        }

        bodyPosts += replaceAll(this.email.post, postReplacements);
    }

    var replacements = {};
    replacements['{posts}'] = bodyPosts;
    return replaceAll(body, replacements);
};

Watcher.prototype.sendEmail = function (subject, body) {
    this.master.sendEmail({
        from: this.email.from,
        to: this.email.to,
        subject: subject,
        body: body
    }, this.logEmailSuccess.bind(this), this.logEmailError.bind(this));
};

Watcher.prototype.log = function(message, debug) {
    //Master should provide a logging function
    message = this.subreddit + ' : ' + message;
    if(this.master.utils && this.master.utils.log)
        this.master.utils.log(message, debug);
    else //fallback
        console.log(message);
};

Watcher.prototype.logEmailSuccess = function () {
    this.log('Successfully sent alert email to '
    + this.email.to + ' via ' + this.master.supportedServices[this.master.service] + '.');
};

Watcher.prototype.logEmailError = function (error, response, body) {
    this.log('Failed to deliver alert email to '
    + this.email.to + ' via ' + this.master.supportedServices[this.master.service] + '.');
    this.log('Check that the provided API key is valid, the chosen service is up, ' +
    'and the from/to email addresses are valid.');

    if (error) this.log('Error: ' + JSON.stringify(error));
    //The response tends to be long and confusing, so log it on debug level 1
    if (response) this.log('Response: ' + JSON.stringify(response), 1);
    if (body) this.log('Body: ' + JSON.stringify(body));
};

module.exports = Watcher;