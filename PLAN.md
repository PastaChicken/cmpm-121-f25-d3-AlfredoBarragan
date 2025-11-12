# D3: {Title Later I dunno for now tho}

# Game Design Vision

{This game involes 4096, Three's & pokemon Go, This game will use cells across the world/ planet earth, the goal of it is the player to craft a token of a value of 256. starting only with 1's & 0's (which i assume is empty) and double with nearby squares all the way until 256 in which case the player wins.}

# Technologies

- TypeScript for most game code, little to no explicit HTML, and all CSS collected in common `style.css` file
- Deno and Vite for building
- GitHub Actions + GitHub Pages for deployment automation

# Assignments

## D3.a: Core mechanics (token collection and crafting)

0: Implement a startder PLAN.md (this file into project) [X]

1: Assemble a map-based user interface using the Leaflet mapping framework. [ ]
1a: Make it the whole world map! either google maps or a world map. [ ]

2:Add tokens that the player can collect (start at 0, player gets 1, finds another 1, gets 2.. ect.. up till 256)
2a. Add tokens first.
2b. make player combine tokens if matching and moving.
2c. make player current token go higher

## D3.b: Globe-spanning gameplay

Key technical challenge: Can you set up your implementation to support gameplay anywhere in the real world, not just locations near our classroom?
Key gameplay challenge: Can players craft an even higher value token by moving to other locations to get access to additional crafting materials?

## D3.c: Object persistence

Key technical challenge: Can your software accurately remember the state of map cells even when they scroll off the screen?
Key gameplay challenge: Can you fix a gameplay bug where players can farm tokens by moving into and out of a region repeatedly to get access to fresh resources?

## D3.d: Gameplay across real-world space and time

Key technical challenges: Can your software remember game state even when the page is closed? Is the player character’s in-game movement controlled by the real-world geolocation of their device?
Key gameplay challenge: Can the user test the game with multiple gameplay sessions, some involving real-world movement and some involving simulated movement?

The game is played across the cells of a rectilinear latitude–longitude grid, spread out over the surface of the planet Earth.
At the start of the game, every cell has either 1 or 0 tokens in it (but the probability of having a token or even whether that probability is constant across space is unspecified, up to the designer's creative choice).
The player can see the contents of any cell on the map, even if they are not near that cell (e.g. by scrolling the map view to see other areas).
The player can only interact with nearby cells (encouraging them to move about the planet to access more cells).
The player can collect a token from a nearby cell or combine it with a token in an existing cell to craft a new token with doubled value.
The player can only have up to one token in hand at a time.
The game is complete when the player has crafted a token of some specific high value (e.g. 256).
