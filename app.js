#! /usr/bin/env node

// disable use strict for now so eval() works.
'use strict';

var https = require('https');
var Q = require('q');
var cheerio = require('cheerio');

var App = function (args) {
  this.selectors = {
    searchPage: {
      videoLinks: 'a.yt-uix-sessionlink.yt-uix-tile-link'
    },
    videoPage: {
      url: 'link[rel=canonical]',
      views: '.watch-view-count',
      likes: 'button.like-button-renderer-like-button > span',
      dislikes: 'button.like-button-renderer-dislike-button > span',
      subscribers: '.yt-subscriber-count',
      keywords: 'meta[name=keywords]'
    }
  };

  this.searchUrlConfig = {
    hour: {
      lclk: 'hour',
      filters: 'video%2Chour'
    },
    today: {
      lclk: 'today',
      filters: 'video%2Ctoday'
    },
    week: {
      lclk: 'week',
      filters: 'video%2Cweek'
    },
    month: {
      lclk: 'month',
      filters: 'video%2Cmonth'
    },
    year: {
      lclk: 'year',
      filters: 'video%2Cyear'
    }
  };

  this.videos = [];
  this.finalKeywords = {};

  var defaultTimeOption = 'week';

  if (args.length === 0) {
    console.log('Enter a search term & time filter to search for keywords.');
    console.log('Search terms with multiple words should be quoted.');
    console.log('Valid time filters are hour, today, week, month, and year.');
    process.exit(); //eslint-disable-line
  }

  if (args.length === 1) {
    console.log('Time filter (hour, today, week, month, year) wasn\'t defined.',
      'Defaulting to week.');
    args[1] = defaultTimeOption;
  }

  if (!(args[1] in this.searchUrlConfig)) {
    console.log('Value given for time filter is invalid. Defaulting to week.');
    args[1] = defaultTimeOption;
  }

  var self = this;

  // search google to get list of video urls
  this.searchPage(this.searchUrl(args[0], args[1]))
    .then(function ($) {
      var videoPageResults = [];

      // get video links in search result page
      $(self.selectors.searchPage.videoLinks).each(function (index, item) {
        videoPageResults.push(self.searchPage('https://www.youtube.com' +
          $(this).attr('href')));
      });

      Q.all(videoPageResults)
        .then(function (pageResults) {
          pageResults.forEach(function ($) { //eslint-disable-line
            var pageData = self.extractPageJS($);

            var formatNum = function (str) {
              return str.replace(/[,]+/ig, '') * 1;
            };

            var data = {
              url: $(self.selectors.videoPage.url).attr('href'),
              likes: formatNum($(self.selectors.videoPage.likes).html()),
              dislikes: formatNum($(self.selectors.videoPage.dislikes).html()),
              subscribers: formatNum($(self.selectors.videoPage.subscribers)
                .html()),
              views: formatNum(pageData.args.view_count),
              keywords: pageData.args.keywords.toLowerCase().split(','),
              avgRating: pageData.args.avg_rating * 1
            };

            self.videos.push(data);
          });

          self.outputReport();
        })
        .fail(function (allErr) {
          console.log('all error:', allErr);
        });
    })
    .fail(function (err) {
      console.log('first search failed:', err);
    });
};

App.prototype = {
  searchUrl: function (query, timeOption) {
    return ['https://www.youtube.com/results?search_sort=video_view_count&',
      'search_query=', query, '&filters=',
      this.searchUrlConfig[timeOption].filters, '&lclk=',
      this.searchUrlConfig[timeOption].lclk].join('');
  },
  searchPage: function (url) {
    var defer = Q.defer();

    this.get(url)
      .then(function (data) {
        defer.resolve(cheerio.load(data));
      })
      .fail(function (err) {
        console.log('SEARCH FAIL: get', err);
      });

    return defer.promise;
  },
  extractPageJS: function ($) {
    // we can get all of the keywords from on-page js. Its dangerous to just
    // eval it, but that's happening here for the time being to get the data.
    var yt = new Function ('var window = {};' +
      $('#player-api ~ script ~ script').html() +
      'return ytplayer;'
    )();

    return yt.config;
  },
  outputReport: function () {
    // Lots of extra data is available to improve the keyword rankings later.
    var self = this;

    self.videos.forEach(function (video) {
      video.keywords.forEach(function (word) {
        if (self.finalKeywords[word]) {
          self.finalKeywords[word]++;
        } else {
          self.finalKeywords[word] = 1;
        }
      });
    });

    var arr = [];
    for (var i in self.finalKeywords) {
      arr.push({
        key: i,
        count: self.finalKeywords[i]
      });
    }

    arr.sort(function (a, b) {
      return b.count - a.count;
    });

    arr = arr.map(function (item) {
      return item.key + ': ' + item.count;
    }).join(', ');

    // final output
    if (arr.length === 0) {
      console.log('No results to show.');
    } else {
      console.log(arr);
    }
  },
  get: function (url) {
    var defer = Q.defer();

    var body = '';
    https.get(url, function (res) {
      res.on('data', function (chunk) {
        body += chunk;
      })
      .on('end', function () {
        defer.resolve(body);
      });
    })
    .on('error', function (err) {
      defer.reject(err);
    });

    return defer.promise;
  }
};

new App(process.argv.slice(2)); //eslint-disable-line

// upload date: last hour, today, this week, this month, this year
// sort by: view count
//https://www.youtube.com/results?search_query=diy&filters=week&search_sort=video_view_count
//console.log(args);
