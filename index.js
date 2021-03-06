const Discord = require("discord.js");
const PasteClient = require("pastebin-api").default;
const https = require("https");
const querystring = require("querystring");
const fs = require("fs");

const discord = new Discord.Client({partials: ["MESSAGE", "CHANNEL", "REACTION"]});
let pastebin = null;

const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

let shippingProviders = {};
let admins = [];

// TODO:
// - add customs items


/*
[key]: {
  code: "key",
  provider: "fedex",
  stage: "free" | "using"
}
 */
let keys = {};

/*
[userId]: {
  stage: "key" | "shipping_details",
  shippingProvider: {
    id: "ups",
    name: "UPS",
    api_id: 5
  },
  key: null,
  detailsStep: 0,
  details: {},
  activityHash: "83djdk12"
}
*/
let currentInteractions = {}

let shippingDetails = [];
let logSettings = [];

let apiSettings = {};

/*
[orderId]: {
  user: "raphy#6535",
  orderId: "728221ce-f77e-cbfe-510f-e38879d53be1"
}
 */
let pendingOrders = {};

async function getParsedOrderInfo(orderId) {
  try {
    let info = JSON.parse(await getOrderInfo(orderId));
    if (!info["Success"] || !info["Data"] || !info["Data"]["Order"]) {
      console.error("Failed to get order #" + orderId + ":", info);
      return null;
    }
    let orderData = info["Data"]["Order"];
    let status = orderData["Status"];

    if (status !== 2) {
      console.info("Order #" + orderId + " is not done ");
      return null;
    }

    return orderData;
  } catch (err) {
    console.error("Failed to check order #" + orderId + ":", err);
    return null;
  }
}

async function checkPendingOrders() {
  let finishedOrders = [];
  console.info("Checking pending orders..");
  for (const orderId in pendingOrders) {
    let pendingOrder = pendingOrders[orderId];
    let orderInfo = await getParsedOrderInfo(orderId);
    if (orderInfo != null) {
      console.info("Order #" + orderId + " is finished!");
      finishedOrders.push(orderId);
      let filename = await getOrderPdf(orderId);
      let user = await discord.users.fetch(pendingOrder.user);


      let orderFromPlace = orderInfo["FromName"] + " at " + orderInfo["FromStreet"] + " " + orderInfo["FromCity"] + ", " + orderInfo["FromState"] + " " + orderInfo["FromZip"] + " " + orderInfo["FromCountry"];
      let orderToPlace = orderInfo["ToName"] + " at " + orderInfo["ToStreet"] + " " + orderInfo["ToCity"] + ", " + orderInfo["ToState"] + " " + orderInfo["ToZip"] + " " + orderInfo["ToCountry"];

      let orderFormatted = "**Provider:** " + orderInfo["ProviderName"] + "\n";
      orderFormatted += "**Created At:** " + orderInfo["AddedFormatted"] + "\n";
      orderFormatted += "**To:** " + orderToPlace + "\n";
      orderFormatted += "**From:** " + orderFromPlace + "\n";
      if (orderInfo["TrackLink"]) {
        orderFormatted += "**Tracking Link:** " + orderInfo["TrackLink"] + "\n";
      }
      orderFormatted += "**Class:** " + orderInfo["ClassFormatted"] + "\n";

      if (!user) {
        console.error("Couldn't find user #" + pendingOrder.user + " for pending order #" + orderId);
      } else {
        await user.send(
          "Your shipping label is ready! \n\n" + orderFormatted, {
            files: [
              filename
            ]
          }
        );
      }

      if (logSettings["enabled_logs"]["order_done"]) {
        broadcastLog(`${user.tag}'s order is ready\n\n` + orderFormatted, {
          files: [
            filename
          ]
        });
      }
    }
  }

  finishedOrders.forEach((orderId) => {
    console.info("Deleting pending order #" + orderId + " as it is finished");
    delete pendingOrders[orderId];
  });
  savePendingOrders();
}

function formatOrder(order) {
  let formattedOrder = "";

  for (const key in order) {
    let value = order[key];
    if (Array.isArray(value) || value === "" || value === null || value === undefined) {
      continue;
    }

    formattedOrder += ` - **${key}**: ${value}\n`;
  }

  return formattedOrder;
}

function formatShippingDetails(order) {
  let formattedOrder = "";

  shippingDetails.forEach((detail) => {
    if (!order.hasOwnProperty(detail.id)) return;
    let value = order[detail.id];

    if (Array.isArray(value) || value === "" || value === null || value === undefined) return;

    if (detail.type === "select" && detail.options.length >= value) {
      value = detail.options[value - 1];
    }

    formattedOrder += ` - **${detail.id}**: ${value}\n`;
  });
  return formattedOrder;
}

async function handleAPIResponse(user, orderDetails, res) {
  let response;
  try {
    response = JSON.parse(res);
  } catch (err) {
    let interaction = currentInteractions[user.id];
    let provider = interaction ? `${interaction.shippingProvider.name} ` : "";

    const pasteUrl = await pastebin.createPaste({
      code: res,
      expireDate: "N",
      name: "Shipping Bot Error Log",
      publicity: 0
    });

    user.send("Failed to create label: An unexpected error occurred! (" + pasteUrl + ")");

    if (logSettings["enabled_logs"]["order_failed"]) {
      broadcastLog(`${user.tag} completed their ${provider}label order and received the following error response: \n${pasteUrl}`);
    }

    resetInteraction(user, false);
    return;
  }

  if (!response["Success"]) {
    console.error("API Error", orderDetails, response);
    let error = response["Error"];

    if (Array.isArray(error)) {
      error = "\n";
      for (let err of response["Error"]) {
        error += ` - ${err["Error"]}\n`;
      }
    }

    user.send("Failed to create label: " + error);

    let interaction = currentInteractions[user.id];
    let provider = interaction ? `${interaction.shippingProvider.name} ` : "";

    if (logSettings["enabled_logs"]["order_failed"]) {
      broadcastLog(`${user.tag} completed their ${provider}label order and received the following error message: ${error}`);
    }

    resetInteraction(user, false);
    return;
  }

  console.info("API Result:", response);

  let order = response["Data"]["Order"];
  let orderId = order["ID"];

  pendingOrders[orderId] = {
    user: user.id,
    orderId: orderId
  };

  savePendingOrders();

  let formattedOrder = formatOrder(order);

  const pasteUrl = await pastebin.createPaste({
    code: formattedOrder,
    expireDate: "N",
    name: "Shipping Order Details",
    publicity: 0
  });

  user.send("Your label order was placed successfully! Once the label has been generated, we'll send you a message. You can view the order details here: " + pasteUrl);

  let interaction = currentInteractions[user.id];
  if (interaction) {

    if (logSettings["enabled_logs"]["order_placed"]) {
      broadcastLog(`${user.tag} placed a label order using the key \`${interaction.key}\`. Response log: ` + pasteUrl);
    }

    if (interaction.key) {
      console.info(`User ${user.tag} used key ${interaction.key}`);
      delete keys[interaction.key];
      saveKeys();
    }

    delete currentInteractions[user.id];
  }
}

async function getOrderPdf(orderId) {
  return new Promise((resolve, reject) => {
    let options = {
      host: "aio.gg",
      port: 443,
      method: "GET",
      path: "/api/order/" + orderId + "/file",
      headers: {
        "Auth": apiSettings["aio_key"]
      }
    };

    let file = "./orders/" + orderId + ".pdf";

    if (!fs.existsSync("./orders")) fs.mkdirSync("./orders");
    fs.writeFileSync(file, "");

    let req = https.request(options, (res) => {
      res.on("data", (chunk) => {
        fs.appendFileSync(file, chunk);
      });

      res.on("end", () => {
        resolve(file);
      });

      res.on("error", (err) => {
        reject(err);
      });
    });

    req.on("error", (err) => {
      reject(err);
    })

    req.end();
  });
}

async function getOrderInfo(orderId) {
  return new Promise((resolve, reject) => {
    let options = {
      host: "aio.gg",
      port: 443,
      method: "GET",
      path: "/api/order/" + orderId + "/info",
      headers: {
        "Auth": apiSettings["aio_key"]
      }
    };


    let req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        resolve(data);
      });

      res.on("error", (err) => {
        reject(err);
      });
    });

    req.on("error", (err) => {
      reject(err);
    })

    req.end();
  });
}

function makeOrder(user, orderDetails) {
  let data = querystring.stringify(orderDetails);

  let options = {
    host: "aio.gg",
    port: 443,
    method: "POST",
    path: "/api/order",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": data.length,
      "Auth": apiSettings["aio_key"]
    }
  };

  let req = https.request(options, (res) => {
    let result = "";
    res.on("data", (chunk) => {
      result += chunk;
    });

    res.on("end", () => {
      console.info("POST data", result);
      handleAPIResponse(user, orderDetails, result);
    });

    res.on("error", (err) => {
      console.error("Error fetching API response", err);
      resetInteraction(user);
    });
  });

  req.on("error", (err) => {
    console.error("Error making API request", err);
    resetInteraction(user);
  })

  req.write(data);
  req.end();
}

function saveKeys() {
  let statelessKeys = [];
  for (let code of Object.keys(keys)) {
    let key = keys[code];
    statelessKeys.push({
      code: key["code"],
      provider: key["provider"]
    });
  }
  let json = JSON.stringify(statelessKeys, null, 2);
  fs.writeFileSync("./data/keys.json", json, "utf8");
}

function savePendingOrders() {
  fs.writeFileSync("./data/pending_orders.json", JSON.stringify(pendingOrders, null, 2), "utf8");
}

function createDataFiles() {
  if (!fs.existsSync("./data/")) {
    fs.mkdirSync("./data/");
  }

  if (!fs.existsSync("./data/logging.json")) {
    console.info("No logging settings file found, recreating the default configuration");
    fs.writeFileSync("./data/logging.json", JSON.stringify({
      log_channels: [
        "864442984116518943"
      ],
      enabled_logs: {
        key_created: false,
        order_started: true,
        order_placed: true,
        order_failed: true,
        order_done: true
      }
    }, null, 2));
  }

  if (!fs.existsSync("./data/shipping_providers.json")) {
    console.info("No shipping providers file found, recreating the default configuration");
    fs.writeFileSync("./data/shipping_providers.json", JSON.stringify({
      "fedex": {
        id: "fedex",
        name: "Fedex",
        api_id: 0,
        international: false,
        enabled: true
      },
      "fedex_international": {
        id: "fedex_international",
        name: "Fedex International",
        api_id: 3,
        international: true,
        enabled: true
      },
      "usps": {
        id: "usps",
        name: "USPS",
        api_id: 2,
        international: false,
        enabled: true
      },
      "ups": {
        id: "ups",
        name: "UPS",
        api_id: 5,
        international: true,
        enabled: true
      },
      "usps3": {
        id: "usps3",
        name: "USPS3",
        api_id: 4,
        international: false,
        enabled: true
      },
    }, null, 2), "utf8");
  }

  if (!fs.existsSync("./data/shipping_details.json")) {
    console.info("No shipping details file found, recreating the default configuration");
    fs.writeFileSync("./data/shipping_details.json", JSON.stringify([
      {
        id: "FromCountry",
        prompt: "the country that you are sending the package from",
        international_only: true,
        international_default: "United States",
      },
      {
        id: "FromName",
        prompt: "the name of the sender",
        min_length: 3
      },
      {
        id: "FromStreet",
        prompt: "the street address of the sender"
      },
      {
        id: "FromStreet2",
        prompt: "the second line of the sender's street address",
        optional: true,
        optional_prompt: "Do you need to include the second line of the senders street address?"
      },
      {
        id: "FromCity",
        prompt: "the city that the package is being sent from"
      },
      {
        id: "FromState",
        prompt: "the sender's two letter state code"
      },
      {
        id: "FromZip",
        prompt: "the zip code that the package is being sent from",
        type: "int"
      },
      {
        id: "FromPhone",
        prompt: "the sender's phone number",
        type: "int"
      },
      {
        id: "ToCountry",
        prompt: "the recipient's country",
        international_only: true,
        international_default: "United States",
      },
      {
        id: "ToName",
        prompt: "the name of the recipient",
        min_length: 3
      },
      {
        id: "ToStreet",
        prompt: "the recipient's street address"
      },
      {
        id: "ToStreet2",
        prompt: "the second line of the recipient's street address",
        optional: true,
        optional_prompt: "Do you need to include the second line of the recipient's street address?"
      },
      {
        id: "ToCity",
        prompt: "the city that the recipient lives in"
      },
      {
        id: "ToState",
        prompt: "the recipient's two letter state code"
      },
      {
        id: "ToZip",
        prompt: "the recipient's zip code",
        type: "int"
      },
      {
        id: "ToPhone",
        prompt: "the recipient's phone number",
        type: "int"
      },
      {
        id: "Weight",
        prompt: "the weight of the package",
        type: "int"
      },
      {
        id: "Length",
        prompt: "the length of the package",
        type: "float"
      },
      {
        id: "Width",
        prompt: "the width of the package",
        type: "float"
      },
      {
        id: "Height",
        prompt: "the height of the package",
        type: "float"
      },
      {
        id: "CustomsPrice",
        prompt: "the customs price for the package",
        type: "float",
        international_only: true,
        international_default: 0
      },
      {
        id: "Class",
        prompt: "Please select the class of your package using the corresponding reaction",
        type: "select",
        options: [
          "First Overnight",
          "Priority Overnight",
          "Standard Overnight",
          "2 Day",
          "Express Save",
          "Ground"
        ]
      },
      {
        id: "SignatureRequired",
        prompt: "Is a signature required on delivery?",
        type: "bool"
      },
      {
        id: "SaturdayShipping",
        prompt: "Do you want your package to be able to be shipped on saturdays?",
        type: "bool"
      },
      {
        id: "Notes",
        prompt: "the notes you want to include on the shipping label",
        optional: true,
        optional_prompt: "Do you want to include a custom note on the shipping label?"
      }
    ], null, 2), "utf8");
  }


  if (!fs.existsSync("./data/admins.json")) {
    console.info("No admins file found, recreating the default configuration");
    fs.writeFileSync("./data/admins.json", JSON.stringify([
      "Shipping Bot#3460",
      "raphy#6666"
    ], null, 2), "utf8");
  }

  if (!fs.existsSync("./data/keys.json")) {
    console.info("No keys file found. An empty key list has been created");
    saveKeys();
  }

  if (!fs.existsSync("./data/pending_orders.json")) {
    console.info("No orders file found, recreating the default configuration");
    savePendingOrders();
  }

  if (!fs.existsSync("./data/api.json")) {
    fs.writeFileSync("./data/api.json", JSON.stringify({
      aio_key: "",
      discord_token: "",
      pastebin_key: ""
    }, null, 2));

    console.error("No API configuration file found! Please add your API keys to api.json and rerun the program!");
    process.exit(1);
  }
}

function loadData() {
  shippingProviders = JSON.parse(fs.readFileSync("./data/shipping_providers.json", "utf8"));
  shippingDetails = JSON.parse(fs.readFileSync("./data/shipping_details.json", "utf8"));
  admins = JSON.parse(fs.readFileSync("./data/admins.json", "utf8"));
  logSettings = JSON.parse(fs.readFileSync("./data/logging.json", "utf8"));
  apiSettings = JSON.parse(fs.readFileSync("./data/api.json", "utf8"));
  pendingOrders = JSON.parse(fs.readFileSync("./data/pending_orders.json", "utf8"));

  let keysArray = JSON.parse(fs.readFileSync("./data/keys.json", "utf8"));
  keys = {};

  for (const key of keysArray) {
    let code = key["code"];
    keys[code] = {
      code: code,
      provider: key["provider"],
      stage: "free"
    }
  }
}

async function broadcastLog(message, extra) {
  for (let channelId of logSettings["log_channels"]) {
    let channel = await discord.channels.fetch(channelId);
    if (!channel) continue;

    await channel.send(message, extra);
  }
}

function makeHash(length) {
  let result = "";
  let hexChars = "0123456789abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < length; i += 1) {
    result += hexChars[Math.floor(Math.random() * hexChars.length)];
  }
  return result;
}

function createKey(provider, length = 8) {
  let code = makeHash(length);
  if (keys.hasOwnProperty(code)) return createKey(length);

  keys[code] = {
    code: code,
    provider: provider.id,
    stage: "free"
  };

  saveKeys();
  return code;
}

function getCustomEmoji(guild, emojiName) {
  if (!guild) {
    console.error("Tried to get emoji :" + emojiName + ": when outside of a guild!");
    return "🚫";
  }

  let emoji = guild.emojis.cache.find(emoji => emoji.name === emojiName);

  if (!emoji) {
    console.error("Couldn't find emoji :" + emojiName + ":");
    return "🚫";
  }

  return emoji;
}

function isAdmin(user) {
  return admins.includes(user.tag);
}

function updateActivityHash(interaction) {
  interaction.activityHash = makeHash(8);
}

async function startNewLabel(user, shippingProvider) {
  resetInteraction(user, false);

  currentInteractions[user.id] = {
    stage: "key",
    shippingProvider: shippingProvider,
    key: null,
    detailsStep: 0,
    details: {
      Provider: shippingProvider["api_id"],
      ScheduleEnabled: 0
    },
    activityHash: makeHash(8)
  };

  user.send(`You've chosen to create a shipping label for ${shippingProvider.name}. Please reply with your key to continue.`);

  if (logSettings["enabled_logs"]["order_started"]) {
    broadcastLog(`${user.tag} initiated a new ${shippingProvider.name} label order`);
  }
}

function resetInteraction(user, error=true) {
  if (!currentInteractions.hasOwnProperty(user.id)) return;

  let interaction = currentInteractions[user.id];

  if (error) {
    console.error("Unexpected user state:", interaction);
    user.send("There was an unexpected error. Your label has been reset");
  }

  if (interaction.key) {
    keys[interaction.key].stage = "free";
    saveKeys();
  }

  delete currentInteractions[user.id];
}

async function getYesNoAnswer(user, message) {
  message.react("👍").then(message.react("👎"));

  const filter = (reaction, reactionUser) => (reaction.emoji.name === '👍' || reaction.emoji.name === "👎") && reactionUser.id === user.id;
  return message.awaitReactions(filter, {max: 1, time: 30000}).then((collected) => {
    let emoji = collected.first().emoji.name;

    if (emoji === "👍") {
      return true;
    } else if (emoji === "👎") {
      return false;
    }
  });

}

async function getNumberAnswer(user, message, options) {
  message.react(NUMBERS[0]).then(async () => {
    for (let i = 1; i < options; i++) {
      await message.react(NUMBERS[i]);
    }
  });

  const filter = (reaction, reactionUser) => NUMBERS.includes(reaction.emoji.name) && reactionUser.id === user.id;
  return message.awaitReactions(filter, {max: 1, time: 30000}).then((collected) => {
    let emoji = collected.first().emoji.name;

    return NUMBERS.indexOf(emoji) + 1;
  });
}

function confirmDetails(user, interaction) {
  let formattedOrder = formatShippingDetails(interaction.details);
  user.send("Do these details look correct: \n" + formattedOrder).then((message) => {
    updateActivityHash(interaction);
    let hash = interaction.activityHash;
    getYesNoAnswer(user, message).then((answer) => {
      if (interaction.activityHash !== hash) return;
      if (answer) {
        user.send("Making api request...");
        console.info("Making api request", interaction.details);
        makeOrder(user, interaction.details);
      } else {
        interaction.details = [];
        interaction.detailsStep = 0;
        interaction.stage = "shipping_details";
        user.send("Okay, restarting the label creation process...");
        continueLabelCreation(user);
        updateActivityHash(interaction);
      }
    }).catch((err) => {
      if (interaction.activityHash !== hash) return;
      user.send("You didn't respond in time!");
      confirmDetails(user, interaction);
    })
  });
}

function nextDetailsStep(user, interaction) {
  interaction.detailsStep += 1;

  // Check if we've finished filling out all the required details
  if (interaction.detailsStep >= shippingDetails.length) {

    interaction.stage = "confirm";
    confirmDetails(user, interaction);
    return;
  }

  let detail = shippingDetails[interaction.detailsStep];
  let provider = interaction.shippingProvider;

  if (detail["international_only"] && !provider["international"]) {
    interaction.details[detail["id"]] = detail["international_default"];
    return nextDetailsStep(user, interaction);
  }

  promptForShippingDetails(user, interaction);
}

function promptForRequiredShippingDetails(user, interaction, details) {
  updateActivityHash(interaction);
  let hash = interaction.activityHash;

  if (details.type === "bool") {
    user.send(details.prompt).then(async (message) => {
      getYesNoAnswer(user, message).then((answer) => {
        if (interaction.activityHash !== hash) return;
        interaction.details[details.id] = answer;
        nextDetailsStep(user, interaction);
      }).catch(() => {
        if (interaction.activityHash !== hash) return;

        message.reply("You didn't respond in time!");
        promptForRequiredShippingDetails(user, interaction, details);
      });
    });
    return;
  } else if (details.type === "select") {
    let prompt = details.prompt + "\n\n";
    for (let i = 0; i < details.options.length; i++) {
      prompt += `${NUMBERS[i]} ${details.options[i]}\n`;
    }

    user.send(prompt).then(async (message) => {
      getNumberAnswer(user, message, details.options.length).then((answer) => {
        if (interaction.activityHash !== hash) return;
        interaction.details[details.id] = answer;
        nextDetailsStep(user, interaction);
      }).catch(() => {
        if (interaction.activityHash !== hash) return;

        message.reply("You didn't respond in time!");
        promptForRequiredShippingDetails(user, interaction, details);
      });
    });
    return;
  }

  user.send(`Please reply with ${details.prompt}`);
}

function promptForShippingDetails(user, interaction) {
  updateActivityHash(interaction);
  let step = interaction.detailsStep;

  if (step >= shippingDetails.length) {
    console.error(`Details step too high! (got ${step}, expected less than ${shippingDetails.length})`);
    resetInteraction(user);
    return;
  }

  let details = shippingDetails[step];
  let hash = interaction.activityHash;

  if (details["optional"]) {
    user.send(details["optional_prompt"]).then(async (message) => {
      getYesNoAnswer(user, message).then((answer) => {
        if (interaction.activityHash !== hash) return;

        if (answer) {
          promptForRequiredShippingDetails(user, interaction, details);
        } else {
          nextDetailsStep(user, interaction);
        }

      }).catch(() => {
        if (interaction.activityHash !== hash) return;

        message.reply("You didn't respond in time!");
        promptForShippingDetails(user);
      });
    });
  } else {
    promptForRequiredShippingDetails(user, interaction, details);
  }
}

function continueLabelCreation(user) {
  if (!currentInteractions.hasOwnProperty(user.id)) {
    user.send("You aren't currently creating a shipping label! Please select a shipping provider in a participating discord server to initiate the process.");
    return;
  }

  let interaction = currentInteractions[user.id];
  updateActivityHash(interaction);

  switch (interaction.stage) {
    case "key":
      user.send("Please reply with your single use shipping key to continue.");
      return;
    case "shipping_details":
      promptForShippingDetails(user, interaction);
      return;
    default:
      resetInteraction(user);
      return;
  }
}

function handleDetailsMessage(message, interaction) {
  let step = interaction.detailsStep;

  if (step > shippingDetails.length) {
    console.error(`Details step too high! (got ${step}, expected less than ${shippingDetails.length})`);
    resetInteraction(message.author);
    return;
  }

  let details = shippingDetails[step];

  if (!details) {
    resetInteraction(message.author);
    return;
  }

  let input = message.content;

  if (details.type === "bool") {
    message.reply("Please respond with a 👍 or 👎 reaction!");
    promptForRequiredShippingDetails(message.author, interaction, details);
    return;
  } else if (details.type === "select") {
    message.reply("Please respond with the emoji reaction that corresponds to your choice");
    promptForRequiredShippingDetails(message.author, interaction, details);
    return;
  } else if (details.type === "int" || details.type === "float") {
    if (isNaN(input)) {
      message.reply("Please respond with a number")
      promptForRequiredShippingDetails(message.author, interaction, details);
      return;
    }
    if (details.type === "int") {
      input = parseInt(input);
    } else {
      input = parseFloat(input);
    }
  } else if (details.min_length > 0) {
    if (input.length < details.min_length) {
      message.reply(`Your response must be at least ${details.min_length} characters long!`);
      promptForRequiredShippingDetails(message.author, interaction, details);
      return;
    }
  }

  message.react("👍");

  interaction.details[details.id] = input;
  nextDetailsStep(message.author, interaction);
}

// Respond to a DM that wasn't sent by ourselves
function handleDM(message) {
  let user = message.author;

  if (!currentInteractions.hasOwnProperty(user.id)) {
    message.reply("You aren't currently creating a shipping label! Please select a shipping provider in a participating discord server to initiate the process.");
    return;
  }

  let interaction = currentInteractions[user.id];

  switch (interaction.stage) {
    case "key":
      let code = message.content;
      if (!keys.hasOwnProperty(code)) {
        message.reply("Invalid key!");
        continueLabelCreation(user);
        return;
      } else if (keys[code].stage !== "free") {
        message.reply("That key is not available for use!");
        continueLabelCreation(user);
        return;
      } else if (!interaction.shippingProvider || keys[code].provider !== interaction.shippingProvider.id) {
        message.reply("That key is only available for use with " + shippingProviders[keys[code].provider].name + " orders!");
        continueLabelCreation(user);
        return;
      }

      interaction.key = code;
      interaction.stage = "shipping_details";

      keys[code].stage = "using";
      saveKeys();

      message.react("👍");

      let detail = shippingDetails[interaction.detailsStep];
      let provider = interaction.shippingProvider;

      if (detail["international_only"] && !provider["international"]) {
        interaction.details[detail["id"]] = detail["international_default"];
        return nextDetailsStep(user, interaction);
      }

      continueLabelCreation(user);
      return;
    case "shipping_details":
      handleDetailsMessage(message, interaction);
      return;
    case "confirm":
      user.send("Please confirm your order using the 👍 or 👎 reaction emojis!");
      confirmDetails(user, interaction);
      return;
    default:
      resetInteraction(user);
      return;
  }
}

discord.on("ready", () => {
  console.log(`Logged in as ${discord.user.tag}!`);
});

discord.on("messageReactionAdd", async (reaction, user) => {
  // If the message was sent before the bot started running, we need to fetch it
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Something went wrong when fetching a message: ', error);
      return;
    }
  }

  // Ignore reactions on direct messages
  if (!reaction.message.guild) return;

  // We only want to listen to reactions on our own messages that aren't by us
  if (user.id === discord.user.id || reaction.message.author.id !== discord.user.id) return;

  await reaction.users.remove(user);

  // Only listen for shipping emoji reactions
  if (!Object.keys(shippingProviders).includes(reaction.emoji.name)) return;
  let shippingProvider = shippingProviders[reaction.emoji.name];

  if (!shippingProvider["enabled"]) {
    await user.send(`You've requested to create a new shipping label with ${shippingProvider.name}, but that provider is currently disabled. Please select a different provider.`);

    if (currentInteractions.hasOwnProperty(user.id)) {
      continueLabelCreation(user);
    }
    return;
  }

  // If the user already has an ongoing interaction, check if they want to restart it
  if (currentInteractions.hasOwnProperty(user.id)) {
    let currentInteraction = currentInteractions[user.id];
    let currentProvider = shippingProviders[currentInteraction.shippingProvider];

    let currentProviderName = "";
    if (currentProvider) {
      currentProviderName = `${currentProvider.name} `;
    }

    updateActivityHash(currentInteraction);
    let hash = currentInteraction.activityHash;

    let msgContent = `You've requested to create a new shipping label with ${shippingProvider.name}, do you want reset your current ${currentProviderName}label?`;
    user.send(msgContent).then(async (message) => {
      getYesNoAnswer(user, message).then((answer) => {
        if (currentInteraction.activityHash !== hash) return;

        if (answer) {
          startNewLabel(user, shippingProvider);
        } else {
          message.reply("Okay, continuing your existing label creation...");
          continueLabelCreation(user);
        }
      }).catch(() => {
        if (currentInteraction.activityHash !== hash) return;
        message.reply("You didn't respond in time! Continuing your existing label creation...")
        continueLabelCreation(user);
      });
    });

    return;
  }

  await startNewLabel(user, shippingProvider);
})

discord.on('message', (message) => {
  // Ignore our own messages
  if (message.author.id === discord.user.id) return;

  if (message.content.startsWith("!shipping key")) {
    if (!isAdmin(message.author)) {
      message.reply("You don't have permission to generate a shipping key!");
      return;
    }

    let args = message.content.split(" ");
    if (args.length < 3) {
      message.reply("Please specify the shipping provider that the key will work with (e.g. `!shipping key fedex`)");
      return;
    }

    let provider = args[2].toLowerCase();
    if (!shippingProviders.hasOwnProperty(provider)) {
      let providerList = Object.keys(shippingProviders).join(", ");
      message.reply("Invalid provider! You can use any of the following providers: " + providerList);
      return;
    }

    provider = shippingProviders[provider];

    // We can only delete messages if they are in a server
    if (message.guild) message.delete();

    let key = createKey(provider);
    message.author.send(`Your single use ${provider.name} shipping key is **${key}**`);

    if (logSettings["enabled_logs"]["key_created"]) {
      broadcastLog(`${message.author.tag} created the ${provider.name} key \`${key}\``)
    }

    return;
  } else if (message.content.startsWith("!shipping label")) {
    if (!isAdmin(message.author)) {
      message.reply("You don't have permission to lookup an order!");
      return;
    }

    let args = message.content.split(" ");
    if (args.length < 3) {
      message.reply("Please specify the order that you'd like to lookup (e.g. `!shipping order d44e2d54-3402-326e-8626-a36c68091fa9`)");
      return;
    }

    let orderId = args[2];

    if (message.guild) message.delete();

    message.author.send("Fetching order #" + orderId + ", please wait...");
    getOrderPdf(orderId).then((filename) => {
      message.author.send(
        "Here is the shipping label you requested", {
          files: [
            filename
          ]
        }
      );
    }).catch((err) => {
      console.error("Failed to get shipping label #" + orderId + ":", err);
      message.author.send("Failed to get shipping label #" + orderId);
    })
    return;
  }

  // If this is a direct message, we need to handle it separately
  if (!message.guild) return handleDM(message);

  if (message.content === '!shipping') {
    message.delete();

    message.channel.send('Select a shipping provider below to create a shipping label').then(async (message) => {
      for (const shippingProvider of Object.keys(shippingProviders)) {
        await message.react(getCustomEmoji(message.guild, shippingProvider));
      }
    });
  }
});

createDataFiles();
loadData();

pastebin = new PasteClient(apiSettings["pastebin_key"]);
discord.login(apiSettings["discord_token"]);

// Check orders every minute
checkPendingOrders();
setInterval(checkPendingOrders, 60 * 1000);