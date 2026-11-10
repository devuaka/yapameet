/** Words for Draw & Guess: concrete, drawable, family friendly. */
const WORDS = 'apple, banana, pizza, burger, taco, donut, cookie, cupcake, ice cream, sandwich, popcorn, pancake, egg, cheese, carrot, cat, dog, fish, bird, snake, turtle, frog, rabbit, horse, cow, pig, sheep, chicken, duck, owl, penguin, elephant, giraffe, lion, tiger, monkey, bear, panda, koala, shark, whale, octopus, crab, snail, spider, bee, butterfly, ladybug, dinosaur, dragon, unicorn, ghost, robot, alien, pirate, ninja, wizard, mermaid, zombie, vampire, astronaut, cowboy, king, queen, house, castle, tent, igloo, bridge, tower, lighthouse, windmill, rocket, airplane, helicopter, car, bus, train, boat, bicycle, skateboard, tractor, submarine, balloon, kite, parachute, sun, moon, star, cloud, rainbow, lightning, snowman, volcano, mountain, island, beach, waterfall, tree, flower, cactus, mushroom, palm tree, tornado, guitar, piano, drum, trumpet, microphone, headphones, camera, phone, laptop, television, clock, lamp, candle, umbrella, glasses, hat, crown, shoe, sock, glove, backpack, scissors, pencil, book, key, lock, ladder, bucket, hammer, magnet, anchor, sword, shield, bow and arrow, treasure, map, compass, trophy, gift, toothbrush, bathtub, toilet, bed, chair, couch, door, window, fence, mailbox, traffic light, soccer ball, basketball, tennis, bowling, surfboard, swing, slide, trampoline, snowflake, fireworks, campfire, spaceship, planet, telescope, magnifying glass, birthday cake, hot dog, french fries, spaghetti, sushi, watermelon, pineapple, cherry, grapes, heart, eye, nose, ear, hand, foot, tooth, skeleton, brain, mustache, beard, cloud, igloo, jellyfish, starfish, seahorse, kangaroo, zebra, hedgehog, bat, squirrel';

export function drawWordList(): string[] {
  return [...new Set(WORDS.split(',').map((w) => w.trim()).filter(Boolean))];
}

/** Would You Rather prompts (original). */
export const WYR: [string, string][] = [
  ['have fingers as long as your legs', 'have legs as long as your fingers'],
  ['always have to sing instead of talk', 'always have to dance instead of walk'],
  ['be able to fly but only 1 meter off the ground', 'be invisible but only when nobody is looking'],
  ['have a pet dragon the size of a cat', 'have a pet cat the size of a dragon'],
  ['only eat pizza forever', 'never eat pizza again'],
  ['have a rewind button for your life', 'have a pause button for your life'],
  ['talk to animals', 'speak every human language'],
  ['live in a treehouse', 'live in a submarine'],
  ['sneeze glitter', 'cry lemonade'],
  ['have unlimited free snacks', 'have unlimited free plane tickets'],
  ['always be 10 minutes late', 'always be 2 hours early'],
  ['have a personal theme song that plays when you walk in', 'have a laugh track for everything you say'],
  ['be the funniest person in the room', 'be the smartest person in the room'],
  ['explore space', 'explore the deep ocean'],
  ['have a robot butler', 'have a self-driving car'],
  ['never use a phone again', 'never watch a video again'],
  ['have super speed', 'have super strength'],
  ['live without music', 'live without movies'],
  ['have a third arm', 'have a third eye'],
  ['be famous on the internet', 'be secretly rich'],
  ['always know when someone is lying', 'always get away with lying'],
  ['eat a bug', 'lick a doorknob'],
  ['have hiccups for a year', 'feel like you need to sneeze for a year'],
  ['be a wizard', 'be a superhero'],
  ['visit the past', 'visit the future'],
  ['have a giant hamster as a pet', 'have a tiny elephant as a pet'],
  ['only be able to whisper', 'only be able to shout'],
  ['wear clown shoes every day', 'wear a clown nose every day'],
  ['live in a world with no internet', 'live in a world with no air conditioning'],
  ['have a dragon', 'be a dragon'],
  ['be stuck on a desert island with your best friend', 'with a stranger who is an expert survivalist'],
  ['have every song you hear stuck in your head', 'never be able to remember any song'],
  ['have a pause button for other people', 'have a mute button for other people'],
  ['only eat breakfast food', 'never eat breakfast food again'],
  ['have the power to teleport', 'have the power to read minds'],
  ['ride a giant snail to work', 'ride a tiny horse to work'],
  ['live on the moon', 'live under the sea'],
  ['have a never-ending ice cream cone', 'a never-ending bag of chips'],
  ['be able to change your hair color with your mind', 'change your eye color with your mind'],
  ['have your browser history made public', 'have your photo gallery made public'],
];
