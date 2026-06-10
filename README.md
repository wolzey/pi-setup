# pi-setup

Version-controlled Pi configuration for Ethan's machines.

This repo tracks Pi agent configuration, extensions, prompts, agents, skills, package manifests, and bootstrap scripts. Secrets and machine-local state are intentionally excluded.

## Bootstrap a machine

```bash
git clone git@github.com:wolzey/pi-setup.git ~/work/github.com/wolzey/pi-setup
cd ~/work/github.com/wolzey/pi-setup
./scripts/apply-to-machine.sh
```

After applying, create `~/.pi/agent/.env` from `agent/.env.example` and authenticate any providers as needed.

## Sync from current machine

```bash
./scripts/sync-from-local.sh
```

Then commit and push changes.
