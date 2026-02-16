const ADJECTIVES = [
  "wobbly", "sneaky", "cosmic", "jolly", "fuzzy", "dizzy", "spicy",
  "bouncy", "grumpy", "sassy", "zippy", "quirky", "lazy", "bubbly",
  "cranky", "funky", "goofy", "nerdy", "peppy", "wacky", "zany",
  "breezy", "cheeky", "dapper", "eager", "flashy", "giddy", "hasty",
  "icy", "jumpy", "keen", "lofty", "mighty", "nifty", "odd",
  "plucky", "rapid", "silly", "tiny", "vivid", "witty", "yappy",
  "bold", "calm", "daring", "epic", "fierce", "gentle", "humble",
];

const CREATURES = [
  "penguin", "walrus", "badger", "otter", "panda", "falcon", "lobster",
  "moose", "sloth", "gecko", "parrot", "squid", "ferret", "mantis",
  "bison", "cobra", "dingo", "eagle", "fox", "gopher", "hawk",
  "iguana", "jackal", "koala", "lemur", "mole", "newt", "owl",
  "possum", "quail", "raven", "salmon", "toad", "urchin", "viper",
  "wombat", "yak", "zebra", "alpaca", "beetle", "crane", "donkey",
  "emu", "frog", "goose", "heron", "impala", "jay", "kiwi",
];

const ACTIONS = [
  "sprint", "tumble", "juggle", "ramble", "hustle", "wobble", "mumble",
  "giggle", "fumble", "doodle", "paddle", "fiddle", "nibble", "waddle",
  "jingle", "tangle", "mingle", "puzzle", "snuggle", "tickle", "rumble",
  "babble", "battle", "bundle", "bustle", "cackle", "castle", "cuddle",
  "dabble", "fizzle", "gargle", "hobble", "jostle", "kindle", "linger",
  "muddle", "nuzzle", "ogle", "ponder", "riddle", "sizzle", "toddle",
  "tumble", "waggle", "wrangle", "yodel", "zigzag", "bumble", "crinkle",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomFunnySlug(): string {
  return `${pick(ADJECTIVES)}-${pick(CREATURES)}-${pick(ACTIONS)}`;
}
