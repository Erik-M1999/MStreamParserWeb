# MStreamParserWeb

Web based service to process and utilize various music streaming APIs.
Includes web based integration of ImmersiveMusicDisplay (https://github.com/Erik-M1999/ImmersiveMusicDisplay)

### How to build locally

Run `docker compose up` in root directory. When launching for the first time, add `--build` at the end of the command.

Fill in .env variables in `backend\.env` in order to get the full suite working as intended.

### For testing it's required that Docker is running

- npm run test:coverage   # one command: starts DB → migrates → runs all tests → writes coverage/ report
- npm test                # all tests without the coverage report
- npm run test:watch      # watch mode


### External API

While the main focus of this web app lies with the actual website, it was my goal to integrate external APIs so that softwares can access user libraries and fetch generated textures.

At the moment only Blender is properly supported. 3Ds Max works, but still needs a lot of polishing thanks to its closed-source.

The extension to install is at:

`\integrations\blender`

You can find a prepared Demo scene file to try it out yourself:

`\integrations\Demo Scenes`

**Guide on using the Blender integrations:**

- Download the .zip file and install it via `"Install from Disk..."` in Preferences -> Add-ons.
- Once installed, you'll have a `Music Streaming Tools` tab inside Add-ons. Inside it fill out the API Key you get through the website. If running the website locally, change the Server URL to yours
- Then in viewport you'll get a new panel on the right side with the same name, `Music Streaming Tools`
- This tool will only fetch user stored files associated with the registered API Key.

**Roadmap:**

- [X] Implement basic Web and Spotify API connection.
- [X] Do not forget to NOT commit API key.
- [X] Integrate and expand ImmersiveMusicDisplay functionality.
- [X] Set up optional login with databases.
- [X] Testing
- [X] Revamp Interface design
- [X] Set up API for external tool access. Test it with 3Ds Max. (Can be improved further)
- [X] Add parser to convert playlists into plain .txt or .csv files.
- [X] Implement a welcome page (Potentially add gifs and pictures)
- [X] Trial a different API: last.fm.
