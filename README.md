# SOS Packet Relay API

This repository contains the Express/Turso headless REST API relay.

## Live API

**[https://meshmash-pushpulllegs.onrender.com](https://meshmash-pushpulllegs.onrender.com)**

- Health check: `https://meshmash-pushpulllegs.onrender.com/health`
- Mesh requests: `POST https://meshmash-pushpulllegs.onrender.com/api/v1/mesh/requests`
- Push packets: `POST https://meshmash-pushpulllegs.onrender.com/api/packets/push`
- Pull packets: `GET https://meshmash-pushpulllegs.onrender.com/api/packets/pull`

The complete setup and usage documentation is here:

**[API server documentation](artifacts/api-server/README.md)**

It includes:

- Local installation and startup
- Render deployment settings
- Required environment variables
- API-key authentication
- Push and pull endpoint examples
- Packet field reference
- JavaScript integration example