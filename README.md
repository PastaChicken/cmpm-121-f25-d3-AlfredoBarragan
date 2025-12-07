# CMPM 121 D3 Project by Alfredo Barragan

Project Documentation:

This includes all my implementation for D3.abcde

PLAN.md contains the steps of how I implemented through each assignment.

Overview: This game is about having the player have real gps location, (or traversial with keyboard and mouse if on pc), the player is free to explore around and collect and combine tokens to achieve the max potential of 256 (or continue this way to keep increasing their highest token). Through implementation I added the following:

D3.a:

Create the map that the player spawn on. (made it start in Mexio City)

Create tokens that randomly generate

revision of PLAN.md,

Allow player traversial with mouse and keyboard (wasd, arrow keys, for moving, mouse for looking around the map.)

Implement gameplay which is allowing players to pick up tokens (only hold one at a time, and allow to combine by "crafting" with a piece matching the same value on a token around the map)

D3.b:

Continue implementation of movment and adding helpful UI

Finish full implentation of crafting, allowing the player to now craft past value 2.

Allow save states of tokens, player is able to traverse far out and be able to load back existing tokens and only load specific tokens that the player can see on the screen.

Refactoring UI

Implementing interfaces for player, and tokens.

D3.c: Implementation refining of savestate for both tokens and player, with both the Flyweight & Memento patterns to my understanding of both patterns.

D3.d: Implementation of GPS based movement.

Had trouble seeing if it worked (hence why deployments are inital implementation for step 7 & 8) but turns out this is a lot easier and was working fine for mobile tests with precise gps tracking compared to laptop & computer tests.

I also refactored & removed existing dupe code.

D3.e

Made minor changes for video testing. I was able to hide ui and shrink and spawn more tiles as to allow to show video of player moving far enough to show collecting and not being able to access a tile that is far enough away

I believe that in the video that my URL was properly shown for the video requested for this part.
