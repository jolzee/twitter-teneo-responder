// var Twitter = require('twitter');
const Twit = require("twit");
const TIE = require("@artificialsolutions/tie-api-client");
const request = require("request");
const shortid = require("shortid");
const dotenv = require("dotenv");
const _ = require("lodash");
const base64 = require("node-base64-image");
// var giphy = require("giphy-api")(process.env.GIPHY_API_KEY);
const path = require("path");
const os = require("os");
const fs = require("fs");
const tmpDir = os.tmpdir(); // Ref to the temporary dir on worker machine
const NodeCache = require("node-cache");
const stopCache = new NodeCache({ stdTTL: 300, checkperiod: 30 }); // 5min cache check every 30 seconds
var flatfile = require("flat-file-db");
var db = flatfile.sync("/tmp/twitter-media.db");
const chalk = require("chalk");
dotenv.config();

let sessions = new Map();
let base64EncodingOptions = { string: true, local: false };
const ourTwitterAccountId = process.env.TWITTER_YOUR_ACCOUNT_ID;
const teneoEngineUrl = process.env.TENEO_TIE_URL;
const teneoClient = TIE.init(teneoEngineUrl);

const templateDMText = {
  event: {
    type: "message_create",
    message_create: {
      target: {
        recipient_id: null
      },
      message_data: {
        text: null
      }
    }
  }
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

var T = new Twit({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token: process.env.TWITTER_ACCESS_TOKEN_KEY,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  timeout_ms: 60 * 1000, // optional HTTP request timeout to apply to all requests.
  strictSSL: true // optional - requires SSL certificates to be valid.
});

function twitterTextResponse(recipientId, message) {
  let response = clone(templateDMText);
  response.event.message_create.target.recipient_id = recipientId;
  response.event.message_create.message_data.text = message;
  return response;
}

//
//  filter the twitter public stream by the words 'CarryMe', '#carryme', '@jolzee'.
//
let whatToTrack = ["CarryMe", "#carryme", "@jolzee"];
var stream = T.stream("statuses/filter", { track: whatToTrack });
console.log(`👂   Listening for Tweets: ` + chalk.black.bgRed(whatToTrack));

stream.on("tweet", function(tweet) {
  if (tweet.user.screen_name !== "jolzee") {
    // console.log(tweet);
    // Once initialized, you no longer need to provide the url in subsequent api calls:
    try {
      stopCache.get(tweet.user.screen_name, true);
    } catch (err) {
      console.log(`🎯   Found a tweet: @${tweet.user.screen_name} "${tweet.text}"`);
      teneoClient.sendInput(sessions.get(tweet.user.screen_name), { text: tweet.text }).then(teneoResponse => {
        respondToStatusUpdate(tweet, teneoResponse);
      });
    }
  }
});

function respondToStatusUpdate(tweet, teneoResponse) {
  // check if sateynet response. If so then don't respond.

  let flag = "good";

  if (teneoResponse.output.parameters.flag) {
    flag = teneoResponse.output.parameters.flag;
  }
  let twitterHandle = tweet.user.screen_name;
  // check if flag says don't respond. Then stop responding for 5min
  if (flag === "good") {
    // console.log(`Teneo Response...`);
    // console.log(teneoResponse);
    sessions.set(tweet.user.screen_name, teneoResponse.sessionId);

    let statusId = tweet.id_str;
    let replyMessage = teneoResponse.output.text;
    let mediaType = "text"; // get from teneo response // text / image / gif / video / giphy
    // let giphySearch = "bad weather";
    let mediaUrl = null;

    if (teneoResponse.output.parameters.extensions) {
      let extensions = JSON.parse(teneoResponse.output.parameters.extensions);
      if (extensions.name === "displayImage") {
        mediaUrl = extensions.parameters.image_url;
        if (_.endsWith(mediaUrl, ".gif")) {
          mediaType = "gif";
        } else if (_.endsWith(mediaUrl, ".jpg")) {
          mediaType = "image";
        }
      } else if (extensions.name === "displayVideo") {
        let videoUrl = extensions.parameters.video_url;
        if (_.endsWith(videoUrl, ".mp4")) {
          mediaUrl = videoUrl;
          mediaType = "video";
        }
      } else if (extensions.name === "displayGiphy") {
        mediaType = "giphy";
        mediaUrl = extensions.parameters.giphy_url;
      }
    }

    let result = db.get(mediaUrl);
    if (result) {
      twitterMediaId = result.mediaId;
    }

    let mediaAlt = "Artificial Solutions";

    if (mediaType === "image") {
      base64.encode(mediaUrl, base64EncodingOptions, (err, result) => {
        if (!err) {
          // let mediaTwitType = mediaType === "image" ? "tweet_image" : "TweetGif";

          uploadImageMedia("tweet_image", mediaUrl, result, mediaAlt, (error, mediaIdStr) => {
            if (!error) {
              let twitterJson = {
                status: `${replyMessage} ${teneoResponse.output.link ? teneoResponse.output.link : ""}`,
                in_reply_to_status_id: statusId,
                auto_populate_reply_metadata: true,
                media_ids: [mediaIdStr]
              };
              postStatusUpdate(twitterJson, twitterHandle);
            } else {
              console.error(error);
            }
          });
        } else {
          console.error(err);
        }
      });
    } else if (mediaType === "gif") {
      let fileName = shortid.generate() + ".gif";
      download(mediaUrl, fileName, function() {
        uploadGif(fileName, mediaUrl, (error, mediaIdStr) => {
          if (!error) {
            let twitterJson = {
              status: `${replyMessage} ${teneoResponse.output.link ? teneoResponse.output.link : ""}`,
              in_reply_to_status_id: statusId,
              auto_populate_reply_metadata: true,
              media_ids: [mediaIdStr]
            };
            postStatusUpdate(twitterJson, twitterHandle);
          } else {
            console.error(error);
          }
        });
      });
    } else if (mediaType === "video") {
      let fileName = shortid.generate() + ".mp4";
      download(mediaUrl, fileName, function() {
        uploadVideo(fileName, mediaUrl, (error, mediaIdStr) => {
          if (!error) {
            let twitterJson = {
              status: `${replyMessage} ${teneoResponse.output.link ? teneoResponse.output.link : ""}`,
              in_reply_to_status_id: statusId,
              auto_populate_reply_metadata: true,
              media_ids: [mediaIdStr]
            };
            postStatusUpdate(twitterJson, twitterHandle);
          } else {
            console.error(error);
          }
        });
      });
    } else if (mediaType === "giphy") {
      let twitterJson = {
        status: `${replyMessage} ${mediaUrl}`,
        in_reply_to_status_id: statusId,
        auto_populate_reply_metadata: true
      };
      postStatusUpdate(twitterJson, twitterHandle);

      // giphy.search(
      //   {
      //     q: giphySearch,
      //     rating: "pg",
      //     limit: 1
      //   },
      //   function(err, res) {
      //     // Res contains gif data!
      //     if (!err) {
      //       let giphyUrl = res.data[0].url;
      //       let twitterJson = {
      //         status: `${replyMessage} ${giphyUrl}`,
      //         in_reply_to_status_id: statusId,
      //         auto_populate_reply_metadata: true
      //       };
      //       postStatusUpdate(twitterJson, twitterHandle);
      //     }
      //   }
      // );
    } else {
      let twitterJson = {
        status: `${replyMessage} ${teneoResponse.output.link ? teneoResponse.output.link : ""}`,
        in_reply_to_status_id: statusId,
        auto_populate_reply_metadata: true
      };
      postStatusUpdate(twitterJson, twitterHandle);
    }
  } else if (flag === "safteynet") {
    // just don't anser but keep the session active
    console.log(`🥅   Safteynet response. Don't respond... this is configurable`);
  } else if (flag === "stop") {
    // add user to skip cache for 5min.
    console.log(`⛔    Stop bot communication with @${twitterHandle} for 5min ⏳ - flag found in Teneo Response`);
    success = stopCache.set(twitterHandle, true);
  }
}

function postStatusUpdate(twitterJson, twitterHandle) {
  T.post("statuses/update", twitterJson, function(err, data, response) {
    if (err) {
      console.error(err);
    } else {
      console.log(`✅    Response to @${twitterHandle} sent ➡ "${twitterJson.status}'`);
      // console.log(data);
    }
  });
}

function respondToDm(messageId, senderId, question) {
  teneoClient.sendInput(sessions.get(senderId), { text: question }).then(teneoResponse => {
    // console.log(teneoResponse);
    if (teneoResponse.output.text !== "") {
      console.log(`➡    Teneo Answer to ${senderId}: ${teneoResponse.output.text}`);
      sessions.set(senderId, teneoResponse.sessionId);
      let twitterTextResp = twitterTextResponse(senderId, teneoResponse.output.text);
      T.post("direct_messages/events/new", twitterTextResp, function(err, data, response) {
        if (err) {
          console.error(err);
        } else {
          console.log(`✅    DM sent`);
          db.put(messageId, { responded: true });
          // console.log(data);
        }
      });
    }
  });
}

function inspectDirectMessages() {
  console.log("🔎   Checking for new DMs... Twitter Activity API would be better");
  T.get("direct_messages/events/list", {}, function(err, data, response) {
    if (err) {
      console.error(err);
    } else {
      var dmsToUs = data.events.filter(function(dm) {
        return dm.message_create.target.recipient_id === ourTwitterAccountId;
      });

      var dmsToOthers = data.events.filter(function(dm) {
        return dm.message_create.sender_id === ourTwitterAccountId;
      });

      let dmsToRespondTo = dmsToUs.filter(function(dm) {
        let timeStamp = dm.created_timestamp;
        let senderId = dm.message_create.sender_id;
        let keep = true;

        dmsToOthers.forEach(otherDm => {
          let timeStampOther = otherDm.created_timestamp;
          let recipientIdOther = otherDm.message_create.target.recipient_id;
          if (senderId === recipientIdOther && timeStamp < timeStampOther) {
            keep = false;
          }
        });

        return keep;
      });

      dmsToRespondTo.forEach(targetDm => {
        // console.log(dm.message_create);
        let messageId = targetDm.id;
        let timeStamp = targetDm.created_timestamp;
        let question = targetDm.message_create.message_data.text;
        let senderId = targetDm.message_create.sender_id;
        let recipientId = targetDm.message_create.target.recipient_id;
        let messageData = targetDm.message_create.message_data;

        // console.log(targetDm);
        // console.log(`${targetDm.message_create.message_data.text}`);
        let result = db.get(messageId, true);
        if (typeof result === "undefined") {
          console.log(
            `🎯   Found DM to respond to ➡  ${targetDm.created_timestamp} | ${targetDm.message_create.message_data.text}`
          );
          respondToDm(messageId, senderId, question);
        }
      });
      // console.log(data);
      // console.log(response);
    }
  });
}

var download = function(uri, filename, callback) {
  let result = db.get(uri);
  if (result) {
    callback(null);
  }
  request.head(uri, function(err, res, body) {
    console.log(`Downloaded ${filename}`);
    console.log("   content-type:", res.headers["content-type"]);
    console.log("   content-length:", res.headers["content-length"]);
    request(uri)
      .pipe(fs.createWriteStream(path.join(tmpDir, filename)))
      .on("close", callback);
  });
};

function uploadImageMedia(mediaCategory, mediaUrl, b64content, altText, callback) {
  let result = db.get(mediaUrl);
  if (result) {
    callback(null, result.mediaId);
  }
  // amplify_video, tweet_gif, tweet_image, and tweet_video
  T.post("media/upload", { media_data: b64content, media_category: mediaCategory }, function(error, data, response) {
    if (!error) {
      // now we can assign alt text to the media, for use by screen readers and
      // other text-based presentations and interpreters
      var mediaIdStr = data.media_id_string;
      var meta_params = { media_id: mediaIdStr, alt_text: { text: altText } };

      T.post("media/metadata/create", meta_params, function(err, data, response) {
        if (!err) {
          console.log("🔱   Uploaded a new media asset to Twitter");
          db.put(mediaUrl, { mediaId: mediaIdStr });
          callback(null, mediaIdStr);
        } else {
          callback(err, null);
        }
      });
    } else {
      console.log(error);
    }
  });
}

function uploadGif(fileName, mediaUrl, callback) {
  let result = db.get(mediaUrl);
  if (result) {
    callback(null, result.mediaId);
  }
  const filePath = path.join(tmpDir, fileName);
  console.log(`uploadMedia: file PATH ${filePath}`);
  T.postMediaChunked(
    {
      file_path: filePath,
      media_category: "TweetGif"
    },
    (err, data, respone) => {
      if (err) {
        callback(err, null);
      } else {
        console.log(data);
        db.put(mediaUrl, { mediaId: data.media_id_string });
        callback(null, data.media_id_string);
      }
    }
  );
}

function uploadVideo(fileName, mediaUrl, callback) {
  let result = db.get(mediaUrl);
  // console.log(result);
  if (result) {
    callback(null, result.mediaId);
  }
  const filePath = path.join(tmpDir, fileName);
  // console.log(`uploadMedia: file PATH ${filePath}`);
  T.postMediaChunked(
    {
      file_path: filePath,
      media_category: "TweetVideo"
    },
    (err, data, respone) => {
      if (err) {
        callback(err, null);
      } else {
        // console.log(data);
        db.put(mediaUrl, { mediaId: data.media_id_string });
        setTimeout(function() {
          callback(null, data.media_id_string);
        }, 10000); // give some time for twitter to process the video
      }
    }
  );
}

inspectDirectMessages();
setInterval(inspectDirectMessages, 62000); // every minute
