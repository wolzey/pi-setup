# pi-setup

Version-controlled Pi configuration for team machines.

This repo tracks Pi agent configuration, extensions, prompts, agents, skills, package manifests, and bootstrap scripts. Secrets and machine-local state are intentionally excluded.

## Install on a machine

Clone this repo and run the apply script:

```bash
git clone git@github.com:wolzey/pi-setup.git ~/work/github.com/wolzey/pi-setup
cd ~/work/github.com/wolzey/pi-setup
./scripts/apply-to-machine.sh
```

If you do not use SSH with GitHub, clone with HTTPS instead:

```bash
git clone https://github.com/wolzey/pi-setup.git ~/work/github.com/wolzey/pi-setup
cd ~/work/github.com/wolzey/pi-setup
./scripts/apply-to-machine.sh
```

The script will:

- install `pi` if it is missing
- copy the repo's `agent/` configuration into `~/.pi/agent`
- create `~/.pi/agent/.env` from `agent/.env.example` if no local `.env` exists
- install configured Pi packages from `settings.json`
- install common LSP servers when the related language tooling is available

After applying, edit `~/.pi/agent/.env` and fill in any required local API keys or provider credentials. Then authenticate any providers as needed.

To install into a different Pi agent directory, set `PI_AGENT_DIR`:

```bash
PI_AGENT_DIR=/path/to/pi-agent ./scripts/apply-to-machine.sh
```

## Sync from current machine

Use this only when intentionally updating the version-controlled setup from a local Pi configuration:

```bash
./scripts/sync-from-local.sh
```

Then commit and push changes.
