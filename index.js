// var Twitter = require('twitter');
const Twit = require("twit");
const TIE = require("@artificialsolutions/tie-api-client");
const request = require("request");
const shortid = require("shortid");
const dotenv = require("dotenv");
const _ = require("lodash");
const base64 = require("node-base64-image");
var giphy = require("giphy-api")(process.env.GIPHY_API_KEY);
const path = require("path");
const os = require("os");
const fs = require("fs");
const tmpDir = os.tmpdir(); // Ref to the temporary dir on worker machine

dotenv.config();

let sessions = new Map();
let handledDMs = [];
let base64EncodingOptions = { string: true, local: false };

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
var stream = T.stream("statuses/filter", { track: ["CarryMe", "#carryme", "@jolzee"] });

stream.on("tweet", function(tweet) {
  console.log(tweet);
  // Once initialized, you no longer need to provide the url in subsequent api calls:
  teneoClient.sendInput(sessions.get(tweet.user.screen_name), { text: tweet.text }).then(teneoResponse => {
    respondToStatusUpdate(tweet, teneoResponse);
  });
});

function respondToStatusUpdate(tweet, teneoResponse) {
  console.log(`Teneo Response...`);
  console.log(teneoResponse);
  sessions.set(tweet.user.screen_name, teneoResponse.sessionId);

  let statusId = tweet.id_str;
  let twitterHandle = tweet.user.screen_name;
  let replyMessage = teneoResponse.output.text;
  let mediaType = "giphy"; // get from teneo response // text / image / gif / video / giphy
  let giphySearch = "bad weather";

  //   let mediaUrl = "http://www.finsmes.com/wp-content/uploads/2018/10/artificial-solutions.jpg";
  //   let mediaUrl = "http://www.quickmeme.com/img/a3/a37b5661e15650d56d28e28b0db9b812ed36e4025d47bba444cf7ead386cf413.jpg"; //sowwy
  //   let mediaUrl = "https://wi.presales.artificial-solutions.com/media/sw/images/gifs/bad-weather.gif";
  //   let mediaUrl = "https://wi.presales.artificial-solutions.com/media/sw/videos/christmas.mp4";

  let mediaAlt = "Artificial Solutions";

  if (mediaType === "image") {
    base64.encode(mediaUrl, base64EncodingOptions, (err, result) => {
      if (!err) {
        // let mediaTwitType = mediaType === "image" ? "tweet_image" : "TweetGif";

        uploadImageMedia("tweet_image", result, mediaAlt, (error, mediaIdStr) => {
          if (!error) {
            let twitterJson = {
              status: `${replyMessage}`,
              in_reply_to_status_id: statusId,
              auto_populate_reply_metadata: true,
              media_ids: [mediaIdStr]
            };
            postStatusUpdate(twitterJson, twitterHandle);
          } else {
            console.log(error);
          }
        });
      } else {
        console.error(err);
      }
    });
  } else if (mediaType === "gif") {
    let fileName = shortid.generate() + ".gif";
    download(mediaUrl, fileName, function() {
      uploadGif(fileName, (error, mediaIdStr) => {
        if (!error) {
          let twitterJson = {
            status: `${replyMessage}`,
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
      uploadVideo(fileName, (error, mediaIdStr) => {
        if (!error) {
          let twitterJson = {
            status: `${replyMessage}`,
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
    giphy.search(
      {
        q: giphySearch,
        rating: "pg",
        limit: 1
      },
      function(err, res) {
        // Res contains gif data!
        if (!err) {
          let giphyUrl = res.data[0].url;
          let twitterJson = {
            status: `${replyMessage} ${giphyUrl}`,
            in_reply_to_status_id: statusId,
            auto_populate_reply_metadata: true
          };
          postStatusUpdate(twitterJson, twitterHandle);
        }
      }
    );
  } else {
    let twitterJson = {
      status: `${replyMessage}`,
      in_reply_to_status_id: statusId,
      auto_populate_reply_metadata: true
    };
    postStatusUpdate(twitterJson, twitterHandle);
  }
}

function postStatusUpdate(twitterJson, twitterHandle) {
  T.post("statuses/update", twitterJson, function(err, data, response) {
    if (err) {
      console.error(err);
    } else {
      console.log(`✅ Response to @${twitterHandle} sent. RE: Status Update: ${twitterJson.in_reply_to_status_id}`);
      console.log(data);
    }
  });
}

function respondToDm(senderId, question) {
  if (!handledDMs.includes(senderId)) {
    console.log(`Responding to ${senderId} who said: ${question}`);
    teneoClient.sendInput(sessions.get(senderId), { text: question }).then(teneoResponse => {
      // console.log(teneoResponse);
      handledDMs.push(senderId);
      console.log(`➡ Teneo Answer to ${senderId}: ${teneoResponse.output.text}`);
      sessions.set(senderId, teneoResponse.sessionId);
      let twitterTextResp = twitterTextResponse(senderId, teneoResponse.output.text);
      T.post("direct_messages/events/new", twitterTextResp, function(err, data, response) {
        if (err) {
          console.error(err);
        } else {
          console.log(`✅ DM sent`);
          // console.log(data);
        }
      });
    });
  }
}

function inspectDirectMessages() {
  console.log("Checking for new DMs...");
  T.get("direct_messages/events/list", {}, function(err, data, response) {
    if (err) {
      console.error(err);
    } else {
      var dmsToUs = data.events.filter(function(dm) {
        return dm.message_create.target.recipient_id === "12239942";
      });

      dmsToUs.forEach(dm => {
        console.log(`${dm.created_timestamp} | ${dm.message_create.message_data.text}`);
      });

      var dmsToOthers = data.events.filter(function(dm) {
        return dm.message_create.sender_id === "12239942";
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
        let id = targetDm.id;
        let timeStamp = targetDm.created_timestamp;
        let question = targetDm.message_create.message_data.text;
        let senderId = targetDm.message_create.sender_id;
        let recipientId = targetDm.message_create.target.recipient_id;
        let messageData = targetDm.message_create.message_data;
        console.log(`${targetDm.message_create.message_data.text}`);
        //respondToDm(senderId, question);
      });
      // console.log(data);
      // console.log(response);
    }
  });
}

var download = function(uri, filename, callback) {
  request.head(uri, function(err, res, body) {
    console.log("content-type:", res.headers["content-type"]);
    console.log("content-length:", res.headers["content-length"]);
    request(uri)
      .pipe(fs.createWriteStream(path.join(tmpDir, filename)))
      .on("close", callback);
  });
};

function uploadImageMedia(mediaCategory, b64content, altText, callback) {
  // amplify_video, tweet_gif, tweet_image, and tweet_video
  T.post("media/upload", { media_data: b64content, media_category: mediaCategory }, function(error, data, response) {
    if (!error) {
      // now we can assign alt text to the media, for use by screen readers and
      // other text-based presentations and interpreters
      var mediaIdStr = data.media_id_string;
      var meta_params = { media_id: mediaIdStr, alt_text: { text: altText } };

      T.post("media/metadata/create", meta_params, function(err, data, response) {
        if (!err) {
          console.log("Uploaded asset");
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

function uploadGif(fileName, callback) {
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
        callback(null, data.media_id_string);
      }
    }
  );
}

function uploadVideo(fileName, callback) {
  const filePath = path.join(tmpDir, fileName);
  console.log(`uploadMedia: file PATH ${filePath}`);
  T.postMediaChunked(
    {
      file_path: filePath,
      media_category: "TweetVideo"
    },
    (err, data, respone) => {
      if (err) {
        callback(err, null);
      } else {
        console.log(data);
        callback(null, data.media_id_string);
      }
    }
  );
}

// setInterval(inspectDirectMessages, 60000);
