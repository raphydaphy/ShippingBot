const Discord = require("discord.js");
const fs = require("fs");

const client = new Discord.Client({partials: ["MESSAGE", "CHANNEL", "REACTION"]});

let shippingProviders = {};
let admins = [];

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
  shippingProvider: "ups",
  key: null,
  detailsStep: 0,
  details: {}
}
*/
let currentInteractions = {}

let shippingDetails = [];

function saveKeys() {
  let keysArray = [];
  let json = JSON.stringify(Object.keys(keys), null, 2);
  fs.writeFileSync("./data/keys.json", json, "utf8");
}

function createDataFiles() {
  if (!fs.existsSync("./data/")) {
    fs.mkdirSync("./data/");
  }

  if (!fs.existsSync("./data/shipping_providers.json")) {
    console.info("No shipping providers file found, recreating the default configuration");
    fs.writeFileSync("./data/shipping_providers.json", JSON.stringify({
      "fedex": {
        id: "fedex",
        name: "Fedex"
      },
      "fedex_international": {
        id: "fedex_international",
        name: "Fedex International"
      },
      "usps": {
        id: "usps",
        name: "USPS"
      },
      "ups": {
        id: "ups",
        name: "UPS"
      }
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
        prompt: "the name of the sender"
      },
      {
        id: "FromStreet",
        prompt: "the street address of the sender"
      },
      {
        id: "FromStreet2",
        prompt: "the second line of the senders street address",
        optional: true,
        optional_prompt: "Does you need to include the second line of the senders street address?"
      },
      {
        id: "FromCity",
        prompt: "the city that the package is being sent from"
      },
      {
        id: "FromState",
        prompt: "the state that the package is being sent from"
      },
      {
        id: "FromZip",
        prompt: "the zip code that the package is being sent from",
        type: "int"
      },
      {
        id: "FromPhone",
        prompt: "the sender's phone number"
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
}

function loadData() {
  shippingProviders = JSON.parse(fs.readFileSync("./data/shipping_providers.json", "utf8"));
  shippingDetails = JSON.parse(fs.readFileSync("./data/shipping_details.json", "utf8"));
  admins = JSON.parse(fs.readFileSync("./data/admins.json", "utf8"));

  let keysArray = JSON.parse(fs.readFileSync("./data/keys.json", "utf8"));
  keys = {};

  for (const code of keysArray) {
    keys[code] = {
      code: "key",
      stage: "free"
    }
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

async function startNewLabel(user, shippingProvider) {
  resetInteraction(user, false);

  currentInteractions[user.id] = {
    stage: "key",
    shippingProvider: shippingProvider,
    key: null,
    details_step: 0,
    details: {}
  };

  user.send(`You've chosen to create a shipping label for ${shippingProvider.name}. Please reply with your key to continue.`);
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

function promptForRequiredShippingDetails(user, interaction, details) {
  user.send(`Please reply with ${details.prompt}`);
}

function promptForShippingDetails(user, interaction) {
  let step = interaction.details_step;

  if (step >= shippingDetails.length) {
    console.error(`Details step too high! (got ${step}, expected less than ${shippingDetails.length})`);
    resetInteraction(user);
    return;
  }

  let details = shippingDetails[step];

  // Check if the user wants to enter this details
  if (details["optional"]) {
    user.send(details["optional_prompt"]).then(async (message) => {
      await message.react("👍");
      await message.react("👎");

      const filter = (reaction, reactionUser) => (reaction.emoji.name === '👍' || reaction.emoji.name === "👎") && reactionUser.id === user.id;
      message.awaitReactions(filter, {max: 1, time: 30000}).then((collected) => {
        let emoji = collected.first().emoji.name;

        if (interaction.details_step !== step) {
          console.info("Reacted after step had already changed. Ignoring");
          return;
        }

        if (emoji === "👍") {
          promptForRequiredShippingDetails(user, interaction, details);
        } else if (emoji === "👎") {
          interaction.details_step += 1;
          continueLabelCreation(user);
        }

      }).catch(() => {
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
  let step = interaction.details_step;

  if (step > shippingDetails.length) {
    console.error(`Details step too high! (got ${step}, expected less than ${shippingDetails.length})`);
    resetInteraction(message.author);
    return;
  }

  message.react("👍");

  interaction.details[shippingDetails[step].id] = message.content;
  interaction.details_step += 1;

  promptForShippingDetails(message.author, interaction);
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

    let msgContent = `You've requested to create a new shipping label with ${shippingProvider.name}, do you want reset your current ${currentProvider.name} label?`;

    user.send(msgContent).then(async (message) => {
      await message.react("👍");
      await message.react("👎");

      const filter = (reaction, reactionUser) => (reaction.emoji.name === '👍' || reaction.emoji.name === "👎") && reactionUser.id === user.id;
      message.awaitReactions(filter, {max: 1, time: 30000}).then((collected) => {
        let emoji = collected.first().emoji.name;

        if (emoji === "👍") {
          startNewLabel(user, shippingProvider);
        } else if (emoji === "👎") {
          message.reply("Okay, continuing your existing label creation...");
          continueLabelCreation(user.id);
        }

      }).catch(() => {
        message.reply("You didn't respond in time! Continuing your existing label creation...")
        continueLabelCreation(user.id);
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

client.login(process.env.DISCORD_TOKEN);