const Discord = require("discord.js");
const https = require("https");
const querystring = require("querystring");
const fs = require("fs");

const client = new Discord.Client({partials: ["MESSAGE", "CHANNEL", "REACTION"]});

const NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

let shippingProviders = {};
let admins = [];

// TODO:
// - add customs items


/*
[key]: {
  code: "key",
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

function handleAPIResponse(user, orderDetails, response) {
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

  console.info("API Result", response);
  user.send("Label created successfully!");


  let interaction = currentInteractions[user.id];
  if (interaction) {

    if (logSettings["enabled_logs"]["order_complete"]) {
      broadcastLog(`${user.tag} completed their ${interaction.shippingProvider.name} label order and received the response message '${response}'`);
    }

    if (interaction.key) {
      console.info(`User ${user.tag} used key ${interaction.key}`);
      delete keys[interaction.key];
      saveKeys();
    }

    delete currentInteractions[user.id];
  }
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
      let res = JSON.parse(result);
      handleAPIResponse(user, orderDetails, res);
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
  let json = JSON.stringify(Object.keys(keys), null, 2);
  fs.writeFileSync("./data/keys.json", json, "utf8");
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
        order_complete: true,
        order_failed: true
      }
    }, null, 2));
  }

  if (!fs.existsSync("./data/shipping_providers.json")) {
    console.info("No shipping providers file found, recreating the default configuration");
    fs.writeFileSync("./data/shipping_providers.json", JSON.stringify({
      "fedex": {
        id: "fedex",
        name: "Fedex",
        api_id: 0
      },
      "fedex_international": {
        id: "fedex_international",
        name: "Fedex International",
        api_id: 3
      },
      "usps": {
        id: "usps",
        name: "USPS",
        api_id: 2
      },
      "ups": {
        id: "ups",
        name: "UPS",
        api_id: 5
      },
      "usps3": {
        id: "usps3",
        name: "USPS3",
        api_id: 4
      },
    }, null, 2), "utf8");
  }

  if (!fs.existsSync("./data/shipping_details.json")) {
    console.info("No shipping details file found, recreating the default configuration");
    fs.writeFileSync("./data/shipping_details.json", JSON.stringify([
      {
        id: "FromCountry",
        prompt: "the country that you are sending the package from"
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
        prompt: "the sender's phone number"
      },
      {
        id: "ToCountry",
        prompt: "the recipient's country"
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
        prompt: "the recipient's phone number"
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
      },
      {
        id: "CustomsPrice",
        prompt: "the customs price for the package",
        type: "float"
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

  if (!fs.existsSync("./data/api.json")) {
    fs.writeFileSync("./data/api.json", JSON.stringify({
      aio_key: "",
      discord_token: ""
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

  let keysArray = JSON.parse(fs.readFileSync("./data/keys.json", "utf8"));
  keys = {};

  for (const code of keysArray) {
    keys[code] = {
      code: "key",
      stage: "free"
    }
  }
}

async function broadcastLog(message) {
  for (let channelId of logSettings["log_channels"]) {
    let channel = await client.channels.fetch(channelId);
    if (!channel) continue;

    await channel.send(message);
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

function createKey(length = 8) {
  let code = makeHash(length);
  if (keys.hasOwnProperty(code)) return createKey(length);

  keys[code] = {
    code: code,
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
      Provider: shippingProvider["api_id"]
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

function nextDetailsStep(user, interaction) {
  interaction.detailsStep += 1;

  // Check if we've finished filling out all the required details
  if (interaction.detailsStep >= shippingDetails.length) {
    user.send("Making api request...");
    console.info("Making api request", interaction.details);
    makeOrder(user, interaction.details);
    return;
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
          interaction.detailsStep += 1;
          continueLabelCreation(user);
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
      }

      interaction.key = code;
      interaction.stage = "shipping_details";

      keys[code].stage = "using";
      saveKeys();

      message.react("👍");
      continueLabelCreation(user);
      return;
    case "shipping_details":
      handleDetailsMessage(message, interaction);
      return;
    default:
      resetInteraction(user);
      return;
  }
}

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on("messageReactionAdd", async (reaction, user) => {
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
  if (user.id === client.user.id || reaction.message.author.id !== client.user.id) return;

  await reaction.users.remove(user);

  // Only listen for shipping emoji reactions
  if (!Object.keys(shippingProviders).includes(reaction.emoji.name)) return;
  let shippingProvider = shippingProviders[reaction.emoji.name];

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

client.on('message', (message) => {
  // Ignore our own messages
  if (message.author.id === client.user.id) return;

  if (message.content === "!shipping key") {
    if (!isAdmin(message.author)) {
      message.reply("You don't have permission to generate a shipping key!");
      return;
    }

    // We can only delete messages if they are in a server
    if (message.guild) message.delete();

    let key = createKey();
    message.author.send(`Your single use shipping key is **${key}**`);

    if (logSettings["enabled_logs"]["key_created"]) {
      broadcastLog(`${message.author.tag} created the key \`${key}\``)
    }

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

client.login(apiSettings["discord_token"]);