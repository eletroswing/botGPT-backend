const { randomUUID } = require("crypto");
const express = require("express");
const app = express();
const http = require("http");
const { createClient } = require("redis");

require("dotenv").config();

var masterQueue = {}

const client = createClient({
  url: process.env.REDIS,
});

client.on("error", (err) => console.log("Redis Client Error", err));

client.connect();

const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const port = 3000;
const Queue = require("bull");

const processQueue = new Queue("process search", process.env.REDIS);

processQueue.process(1, async function (job, done) {
  Object.keys(masterQueue).forEach((key) => {
    io.emit("queue-att", {
      messageId: masterQueue[key].messageId,
      guildId: masterQueue[key].guildId,
      channelId: masterQueue[key].channelId,
      queue:  masterQueue[key].queue - 1 || 1,
    });

      masterQueue[key].queue = masterQueue[key].queue - 1

  });


  var search = await fetch("https://phind.com/api/search", {
    headers: {
      accept: "*/*",
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "cache-control": "no-cache",
      "content-type": "application/json",
      pragma: "no-cache",
      "sec-ch-ua":
        '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    },
    referrer: `https://phind.com/search?q=${job.data.query}`,
    referrerPolicy: "strict-origin-when-cross-origin",
    body: `{\"freshness\":\"\",\"q\":\"${job.data.query}\",\"userRankList\":{\"developer.mozilla.org\":1,\"github.com\":1,\"stackoverflow.com\":1,\"www.reddit.com\":1,\"en.wikipedia.org\":1,\"www.amazon.com\":-1,\"www.quora.com\":-2,\"www.pinterest.com\":-3,\"rust-lang\":2,\".rs\":1}}`,
    method: "POST",
    mode: "cors",
    credentials: "include",
  });

  search = await search.json();

  const stream = await fetch("https://phind.com/api/tldr", {
    headers: {
      accept: "application/json",
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "cache-control": "no-cache",
      "content-type": "application/json",
      pragma: "no-cache",
      "sec-ch-ua":
        '"Chromium";v="110", "Not A(Brand";v="24", "Google Chrome";v="110"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    },
    referrer: `https://phind.com/search?q=${job.data.query}`,
    referrerPolicy: "strict-origin-when-cross-origin",
    body: JSON.stringify({
      bingResults: search.processedBingResults,
      question: decodeURI(job.data.query),
    }),
    method: "POST",
    mode: "cors",
    credentials: "include",
  });

  const reader = stream.body?.pipeThrough(new TextDecoderStream()).getReader();
  let responseToDiscord = []
  var name = null;
  var valueForReturn = null;

  while (true) {
    const { value, done } = await reader?.read();
    if (done) break;
    let newValue = value.split('data:')
    
    newValue = JSON.parse(newValue[1].replace('\n', '').replace('\r', ''))

    if(newValue['sentence']) {
      if(!name && !valueForReturn){
        name = newValue.sentence
        
      }else {
        valueForReturn = newValue.sentence
        responseToDiscord.push({
          name: name,
          value: valueForReturn,
        })

        name = null;
        valueForReturn = null
      }
    }
  }

  if(responseToDiscord.length >= 25){
    responseToDiscord = responseToDiscord.slice(0, 23)
    
  }
  responseToDiscord.push({
    name: "The content is oversized. Try to open: ",
    value: `https://phind.com/search?q=${encodeURI(job.data.query)}`
  })
  io.emit("clear-embed", {
    messageId: job.data.messageId,
    guildId: job.data.guildId,
    channelId: job.data.channelId,
    query: job.data.query
  });

  delete masterQueue[job.data.id];

  io.emit("queue-response", {
    query: job.data.query,
    messageId: job.data.messageId,
    guildId: job.data.guildId,
    channelId: job.data.channelId,
    response: responseToDiscord
  });

  done(undefined, job.data);
});

//api =====================================
app.get("/search-discord", async (req, res) => {
  if (
    !req.query.q ||
    !req.query.messageId ||
    !req.query.guildId ||
    !req.query.channelId
  )
    return res.status(403).json({ message: "error" });
  let id = randomUUID();
  let context = {
    query: req.query.q,
    messageId: req.query.messageId,
    channelId: req.query.channelId,
    guildId: req.query.guildId,
    id: id,
    queue: Object.keys(masterQueue).length + 1
  };

  
  masterQueue[id] = context;
  processQueue.add(context);

  res.status(200).json({
    queue: Object.keys(masterQueue).length,
  });
});

server.listen(process.env.PORT || port, () => {
  console.log(`Example app listening on port ${port}`);
});
