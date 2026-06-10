#!/usr/bin/env bash
set -euo pipefail

# LaunchDarkly REST API CLI — interact with LaunchDarkly via api/v2
#
# Auth resolution order: per-command flags > env vars > active profile > error
#   Flags:     --api-key, --environment, --project
#   Env vars:  LAUNCHDARKLY_API_TOKEN, LAUNCHDARKLY_ENVIRONMENT, LAUNCHDARKLY_PROJECT_KEY
#   Profiles:  ~/.config/launchdarkly/<profile>.json
#
# Profile management:
#   config create <name> --api-key <token> [--environment <env>] [--project <key>]
#   config set profile <name>          Set active profile
#   config set environment <env>       Update active profile's defaultEnvironment
#   config get profile                 Show active profile
#   config list                        List all profiles
#   config delete <name>               Delete a profile

LD_BASE_URL="https://app.launchdarkly.com/api/v2"
LD_API_VERSION="20240415"
LD_CONFIG_DIR="$HOME/.config/launchdarkly"
LD_CURRENT_FILE="$LD_CONFIG_DIR/current"
LD_DEFAULT_PROJECT="default"

# Values resolved at runtime — set by global flags, env, or profile
_API_KEY=""
_ENVIRONMENT=""
_PROJECT_KEY=""
# Session-only override from --profile flag; does not persist to disk.
_PROFILE_OVERRIDE=""

# ─── Profile Helpers ──────────────────────────────────────────────────────────

ensure_config_dir() {
  mkdir -p "$LD_CONFIG_DIR"
}

get_current_profile() {
  if [[ -n "$_PROFILE_OVERRIDE" ]]; then
    echo "$_PROFILE_OVERRIDE"
  elif [[ -f "$LD_CURRENT_FILE" ]]; then
    cat "$LD_CURRENT_FILE"
  fi
}

set_current_profile() {
  ensure_config_dir
  echo "$1" > "$LD_CURRENT_FILE"
}

profile_path() {
  echo "$LD_CONFIG_DIR/$1.json"
}

profile_exists() {
  [[ -f "$(profile_path "$1")" ]]
}

read_profile_field() {
  local profile="$1" field="$2"
  local path
  path=$(profile_path "$profile")
  if [[ -f "$path" ]]; then
    jq -r ".$field // empty" "$path"
  fi
}

write_profile_field() {
  local profile="$1" field="$2" value="$3"
  local path
  path=$(profile_path "$profile")
  if [[ ! -f "$path" ]]; then
    echo "Error: Profile '$profile' does not exist." >&2
    return 1
  fi
  local tmp
  tmp=$(mktemp)
  jq --arg v "$value" ".$field = \$v" "$path" > "$tmp"
  mv "$tmp" "$path"
}

# ─── URL helpers ──────────────────────────────────────────────────────────────

urlenc() {
  jq -rn --arg v "$1" '$v|@uri'
}

# ─── Auth Resolution ─────────────────────────────────────────────────────────

resolve_auth() {
  local profile
  profile=$(get_current_profile)

  # API key: flag > env > profile
  if [[ -z "$_API_KEY" ]]; then
    _API_KEY="${LAUNCHDARKLY_API_TOKEN:-}"
  fi
  if [[ -z "$_API_KEY" ]] && [[ -n "$profile" ]]; then
    _API_KEY=$(read_profile_field "$profile" "apiKey")
  fi

  # Environment: flag > env > profile
  if [[ -z "$_ENVIRONMENT" ]]; then
    _ENVIRONMENT="${LAUNCHDARKLY_ENVIRONMENT:-}"
  fi
  if [[ -z "$_ENVIRONMENT" ]] && [[ -n "$profile" ]]; then
    _ENVIRONMENT=$(read_profile_field "$profile" "defaultEnvironment")
  fi

  # Project key: flag > env > profile > default
  if [[ -z "$_PROJECT_KEY" ]]; then
    _PROJECT_KEY="${LAUNCHDARKLY_PROJECT_KEY:-}"
  fi
  if [[ -z "$_PROJECT_KEY" ]] && [[ -n "$profile" ]]; then
    _PROJECT_KEY=$(read_profile_field "$profile" "projectKey")
  fi
  [[ -z "$_PROJECT_KEY" ]] && _PROJECT_KEY="$LD_DEFAULT_PROJECT"

  if [[ -z "$_API_KEY" ]]; then
    echo "Error: Missing API key." >&2
    echo "Set one of:" >&2
    echo "  - LAUNCHDARKLY_API_TOKEN env var" >&2
    echo "  - --api-key <token> flag" >&2
    echo "  - $(basename "$0") config create <name> --api-key <token>" >&2
    return 1
  fi
}

require_environment() {
  if [[ -z "$_ENVIRONMENT" ]]; then
    echo "Error: No environment set. Pass --environment <env>, set LAUNCHDARKLY_ENVIRONMENT, or set defaultEnvironment in your profile." >&2
    return 1
  fi
}

# ─── HTTP Helpers ─────────────────────────────────────────────────────────────

ld_request() {
  local method="$1" path="$2"
  shift 2
  local data="" query="" content_type="application/json"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --data)           data="$2";  shift 2 ;;
      --query)          query="$2"; shift 2 ;;
      --semantic-patch) content_type="application/json; domain-model=launchdarkly.semanticpatch"; shift ;;
      *) echo "Error: unknown option '$1'" >&2; return 1 ;;
    esac
  done

  resolve_auth

  local url="${LD_BASE_URL}${path}"
  if [[ -n "$query" ]]; then
    url="${url}?${query}"
  fi

  local curl_args=(-s -w "\n%{http_code}" -X "$method"
    -H "Authorization: ${_API_KEY}"
    -H "LD-API-Version: ${LD_API_VERSION}"
    -H "Content-Type: ${content_type}"
    -H "Accept: application/json")

  if [[ -n "$data" ]]; then
    curl_args+=(-d "$data")
  fi

  local response http_code body
  response=$(curl "${curl_args[@]}" "$url")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" -ge 400 ]]; then
    echo "Error: HTTP $http_code" >&2
    echo "$body" | jq . 2>/dev/null >&2 || echo "$body" >&2
    return 1
  fi

  if [[ -n "$body" ]]; then
    echo "$body" | jq .
  fi
}

ld_get()    { ld_request GET    "$@"; }
ld_post()   { ld_request POST   "$@"; }
ld_patch()  { ld_request PATCH  "$@"; }
ld_delete() { ld_request DELETE "$@"; }

# ─── Commands ─────────────────────────────────────────────────────────────────

cmd_me() {
  ld_get "/caller-identity"
}

# --- Config ---

cmd_config() {
  local subcmd="${1:-}"
  shift || true

  case "$subcmd" in
    set)
      local what="${1:-}"
      shift || true
      case "$what" in
        profile)
          local name="${1:?Usage: config set profile <name>}"
          if ! profile_exists "$name"; then
            echo "Error: Profile '$name' does not exist." >&2
            echo "Create it first: $(basename "$0") config create $name --api-key <token>" >&2
            return 1
          fi
          set_current_profile "$name"
          echo "Active profile set to: $name"
          ;;
        environment)
          local env="${1:?Usage: config set environment <env>}"
          local current
          current=$(get_current_profile)
          if [[ -z "$current" ]]; then
            echo "Error: No active profile. Run config set profile <name> first." >&2
            return 1
          fi
          write_profile_field "$current" "defaultEnvironment" "$env"
          echo "Profile '$current' defaultEnvironment set to: $env"
          ;;
        *) echo "Usage: config set <profile|environment> <value>" >&2; return 1 ;;
      esac
      ;;

    get)
      local what="${1:-profile}"
      case "$what" in
        profile)
          local current
          current=$(get_current_profile)
          if [[ -z "$current" ]]; then
            echo "No active profile set."
          else
            echo "Active profile: $current"
            if profile_exists "$current"; then
              jq '.' "$(profile_path "$current")" | jq '.apiKey = "***"'
            fi
          fi
          ;;
        *) echo "Usage: config get profile" >&2; return 1 ;;
      esac
      ;;

    create)
      local name="${1:?Usage: config create <name> --api-key <token> [--environment <env>] [--project <key>]}"
      shift
      local api_key="" environment="" project_key=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --api-key)     api_key="$2"; shift 2 ;;
          --environment) environment="$2"; shift 2 ;;
          --project)     project_key="$2"; shift 2 ;;
          *) echo "Error: unknown option '$1'" >&2; return 1 ;;
        esac
      done
      if [[ -z "$api_key" ]]; then
        echo "Usage: config create <name> --api-key <token> [--environment <env>] [--project <key>]" >&2
        return 1
      fi
      ensure_config_dir
      local payload
      payload=$(jq -n \
        --arg ak "$api_key" \
        --arg env "$environment" \
        --arg pk "$project_key" \
        '{apiKey:$ak} + (if $env != "" then {defaultEnvironment:$env} else {} end) + (if $pk != "" then {projectKey:$pk} else {} end)')
      echo "$payload" > "$(profile_path "$name")"
      chmod 600 "$(profile_path "$name")"
      echo "Profile '$name' created."

      if [[ -z "$(get_current_profile)" ]]; then
        set_current_profile "$name"
        echo "Set as active profile."
      fi
      ;;

    list)
      ensure_config_dir
      local current
      current=$(get_current_profile)
      local found=false
      for f in "$LD_CONFIG_DIR"/*.json; do
        [[ -f "$f" ]] || continue
        found=true
        local name env proj
        name=$(basename "$f" .json)
        env=$(jq -r '.defaultEnvironment // "—"' "$f")
        proj=$(jq -r '.projectKey // "default"' "$f")
        if [[ "$name" == "$current" ]]; then
          echo "* $name  (env: $env, project: $proj)"
        else
          echo "  $name  (env: $env, project: $proj)"
        fi
      done
      if [[ "$found" == "false" ]]; then
        echo "No profiles found. Create one with:"
        echo "  $(basename "$0") config create <name> --api-key <token> [--environment <env>] [--project <key>]"
      fi
      ;;

    delete)
      local name="${1:?Usage: config delete <name>}"
      local path
      path=$(profile_path "$name")
      if [[ ! -f "$path" ]]; then
        echo "Error: Profile '$name' does not exist." >&2; return 1
      fi
      rm "$path"
      echo "Profile '$name' deleted."
      if [[ "$(get_current_profile)" == "$name" ]]; then
        rm -f "$LD_CURRENT_FILE"
        echo "Active profile cleared."
      fi
      ;;

    *)
      echo "Usage: config <set|get|create|list|delete>" >&2
      return 1
      ;;
  esac
}

# --- Project ---

cmd_project() {
  local subcmd="${1:-list}"
  shift || true

  case "$subcmd" in
    list)
      ld_get "/projects"
      ;;
    get)
      resolve_auth
      local key="${1:-$_PROJECT_KEY}"
      ld_get "/projects/$(urlenc "$key")"
      ;;
    *)
      echo "Usage: project <list|get>" >&2; return 1 ;;
  esac
}

# --- Environment ---

cmd_environment() {
  local subcmd="${1:-list}"
  shift || true

  local project=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --project) project="$2"; shift 2 ;;
      *) echo "Error: unknown option '$1'" >&2; return 1 ;;
    esac
  done

  resolve_auth
  [[ -z "$project" ]] && project="$_PROJECT_KEY"

  case "$subcmd" in
    list) ld_get "/projects/$(urlenc "$project")/environments" ;;
    *)    echo "Usage: environment list [--project <key>]" >&2; return 1 ;;
  esac
}

# --- Flag ---

build_default_variations() {
  jq -n '[{value:true,name:"On"},{value:false,name:"Off"}]'
}

cmd_flag() {
  local subcmd="${1:-}"
  shift || true

  case "$subcmd" in
    list)
      local project="" env="" tag="" limit="50"
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --project) project="$2"; shift 2 ;;
          --env)     env="$2"; shift 2 ;;
          --tag)     tag="$2"; shift 2 ;;
          --limit)   limit="$2"; shift 2 ;;
          *) echo "Error: unknown option '$1'" >&2; return 1 ;;
        esac
      done
      resolve_auth
      [[ -z "$project" ]] && project="$_PROJECT_KEY"
      [[ -z "$env" ]] && env="$_ENVIRONMENT"
      local query="limit=$(urlenc "$limit")"
      [[ -n "$env" ]] && query="${query}&env=$(urlenc "$env")"
      [[ -n "$tag" ]] && query="${query}&tag=$(urlenc "$tag")"
      ld_get "/flags/$(urlenc "$project")" --query "$query"
      ;;

    get)
      local key="${1:-}"
      shift || true
      local project=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --project) project="$2"; shift 2 ;;
          *) echo "Error: unknown option '$1'" >&2; return 1 ;;
        esac
      done
      if [[ -z "$key" ]]; then
        echo "Usage: flag get <key> [--project <key>]" >&2; return 1
      fi
      resolve_auth
      [[ -z "$project" ]] && project="$_PROJECT_KEY"
      ld_get "/flags/$(urlenc "$project")/$(urlenc "$key")"
      ;;

    create)
      local key="" name="" description="" kind="boolean" variations_json="" project="" temporary="false"
      local tags=()
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --key)         key="$2"; shift 2 ;;
          --name)        name="$2"; shift 2 ;;
          --description) description="$2"; shift 2 ;;
          --kind)        kind="$2"; shift 2 ;;
          --variations)  variations_json="$2"; shift 2 ;;
          --tag)         tags+=("$2"); shift 2 ;;
          --project)     project="$2"; shift 2 ;;
          --temporary)   temporary="true"; shift ;;
          *) echo "Error: unknown option '$1'" >&2; return 1 ;;
        esac
      done
      if [[ -z "$key" ]] || [[ -z "$name" ]]; then
        echo "Usage: flag create --key <k> --name <n> [--description <d>] [--kind boolean|multivariate] [--variations <json-array>] [--tag <t>]... [--temporary]" >&2
        return 1
      fi
      if [[ -z "$variations_json" ]]; then
        if [[ "$kind" != "boolean" ]]; then
          echo "Error: --variations <json> required when --kind is not boolean" >&2
          return 1
        fi
        variations_json=$(build_default_variations)
      fi
      resolve_auth
      [[ -z "$project" ]] && project="$_PROJECT_KEY"

      local tags_json="[]"
      if [[ ${#tags[@]} -gt 0 ]]; then
        tags_json=$(jq -n --args '$ARGS.positional' "${tags[@]}")
      fi

      local payload
      payload=$(jq -n \
        --arg key "$key" \
        --arg name "$name" \
        --arg description "$description" \
        --arg kind "$kind" \
        --argjson variations "$variations_json" \
        --argjson tags "$tags_json" \
        --argjson temporary "$temporary" \
        '{key:$key, name:$name, kind:$kind, variations:$variations, temporary:$temporary, tags:$tags}
         + (if $description != "" then {description:$description} else {} end)')

      ld_post "/flags/$(urlenc "$project")" --data "$payload"
      ;;

    update)
      local key="${1:-}"
      shift || true
      local project=""
      local json_patches=()
      local add_tags=()
      local remove_tags=()
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --name)        json_patches+=("$(jq -n --arg v "$2" '{op:"replace",path:"/name",value:$v}')"); shift 2 ;;
          --description) json_patches+=("$(jq -n --arg v "$2" '{op:"replace",path:"/description",value:$v}')"); shift 2 ;;
          --add-tag)     add_tags+=("$2"); shift 2 ;;
          --remove-tag)  remove_tags+=("$2"); shift 2 ;;
          --project)     project="$2"; shift 2 ;;
          *) echo "Error: unknown option '$1'" >&2; return 1 ;;
        esac
      done
      if [[ -z "$key" ]] || { [[ ${#json_patches[@]} -eq 0 ]] && [[ ${#add_tags[@]} -eq 0 ]] && [[ ${#remove_tags[@]} -eq 0 ]]; }; then
        echo "Usage: flag update <key> [--name <n>] [--description <d>] [--add-tag <t>] [--remove-tag <t>] [--project <k>]" >&2
        return 1
      fi
      resolve_auth
      [[ -z "$project" ]] && project="$_PROJECT_KEY"

      # Tags are flag-level (not env-level). Compute the desired tags array by
      # fetching current tags, removing requested entries, and appending new ones,
      # then send a single JSON Patch replace on /tags. This avoids the broken
      # semantic-patch path and a partial-failure window.
      if [[ ${#add_tags[@]} -gt 0 ]] || [[ ${#remove_tags[@]} -gt 0 ]]; then
        local current_tags new_tags removes_json adds_json
        current_tags=$(ld_get "/flags/$(urlenc "$project")/$(urlenc "$key")" 2>/dev/null | jq '.tags // []')
        if [[ -z "$current_tags" ]]; then
          echo "Error: failed to fetch current tags for ${key}" >&2
          return 1
        fi
        if [[ ${#remove_tags[@]} -gt 0 ]]; then
          removes_json=$(jq -n --args '$ARGS.positional' "${remove_tags[@]}")
        else
          removes_json='[]'
        fi
        if [[ ${#add_tags[@]} -gt 0 ]]; then
          adds_json=$(jq -n --args '$ARGS.positional' "${add_tags[@]}")
        else
          adds_json='[]'
        fi
        new_tags=$(jq -n \
          --argjson cur "$current_tags" \
          --argjson rm  "$removes_json" \
          --argjson add "$adds_json" \
          '($cur - $rm + $add) | unique')
        json_patches+=("$(jq -n --argjson v "$new_tags" '{op:"replace",path:"/tags",value:$v}')")
      fi

      local patch_array
      patch_array=$(printf '%s\n' "${json_patches[@]}" | jq -s .)
      ld_patch "/flags/$(urlenc "$project")/$(urlenc "$key")" --data "$patch_array"
      ;;

    delete)
      local key="${1:-}"
      shift || true
      local project=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --project) project="$2"; shift 2 ;;
          *) echo "Error: unknown option '$1'" >&2; return 1 ;;
        esac
      done
      if [[ -z "$key" ]]; then
        echo "Usage: flag delete <key> [--project <key>]" >&2; return 1
      fi
      resolve_auth
      [[ -z "$project" ]] && project="$_PROJECT_KEY"
      ld_delete "/flags/$(urlenc "$project")/$(urlenc "$key")"
      ;;

    on|off)
      local key="${1:-}"
      shift || true
      local env="" project="" comment=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --env)     env="$2"; shift 2 ;;
          --project) project="$2"; shift 2 ;;
          --comment) comment="$2"; shift 2 ;;
          *) echo "Error: unknown option '$1'" >&2; return 1 ;;
        esac
      done
      if [[ -z "$key" ]]; then
        echo "Usage: flag $subcmd <key> [--env <env>] [--project <key>] [--comment <text>]" >&2; return 1
      fi
      resolve_auth
      [[ -z "$project" ]] && project="$_PROJECT_KEY"
      [[ -z "$env" ]] && env="$_ENVIRONMENT"
      require_environment

      local kind="turnFlagOff"
      [[ "$subcmd" == "on" ]] && kind="turnFlagOn"

      local payload
      payload=$(jq -n \
        --arg env "$env" \
        --arg kind "$kind" \
        --arg comment "$comment" \
        '{environmentKey:$env, instructions:[{kind:$kind}]}
         + (if $comment != "" then {comment:$comment} else {} end)')
      ld_patch "/flags/$(urlenc "$project")/$(urlenc "$key")" --data "$payload" --semantic-patch
      ;;

    status)
      local key="${1:-}"
      shift || true
      local env="" project=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --env)     env="$2"; shift 2 ;;
          --project) project="$2"; shift 2 ;;
          *) echo "Error: unknown option '$1'" >&2; return 1 ;;
        esac
      done
      if [[ -z "$key" ]]; then
        echo "Usage: flag status <key> [--env <env>] [--project <key>]" >&2; return 1
      fi
      resolve_auth
      [[ -z "$project" ]] && project="$_PROJECT_KEY"
      [[ -z "$env" ]] && env="$_ENVIRONMENT"
      require_environment
      ld_get "/flag-statuses/$(urlenc "$project")/$(urlenc "$env")/$(urlenc "$key")"
      ;;

    rollout)
      local key="${1:-}"
      shift || true
      local percentage="" env="" project=""
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --percentage) percentage="$2"; shift 2 ;;
          --env)        env="$2"; shift 2 ;;
          --project)    project="$2"; shift 2 ;;
          *) echo "Error: unknown option '$1'" >&2; return 1 ;;
        esac
      done
      if [[ -z "$key" ]] || [[ -z "$percentage" ]]; then
        echo "Usage: flag rollout <key> --percentage <0-100> [--env <env>] [--project <key>]" >&2; return 1
      fi
      if ! [[ "$percentage" =~ ^[0-9]+$ ]] || (( percentage < 0 || percentage > 100 )); then
        echo "Error: --percentage must be an integer between 0 and 100 (got: $percentage)" >&2; return 1
      fi
      resolve_auth
      [[ -z "$project" ]] && project="$_PROJECT_KEY"
      [[ -z "$env" ]] && env="$_ENVIRONMENT"
      require_environment

      # weight is in /1000 (so 50% = 50000); LD's "true" variation index is 0, "false" is 1
      local true_weight false_weight
      true_weight=$(( percentage * 1000 ))
      false_weight=$(( (100 - percentage) * 1000 ))

      local payload
      payload=$(jq -n \
        --arg env "$env" \
        --argjson tw "$true_weight" \
        --argjson fw "$false_weight" \
        '{environmentKey:$env,
          instructions:[{
            kind:"updateFallthroughVariationOrRollout",
            rolloutWeights: { "0": $tw, "1": $fw }
          }]}')
      ld_patch "/flags/$(urlenc "$project")/$(urlenc "$key")" --data "$payload" --semantic-patch
      ;;

    *)
      echo "Unknown flag subcommand: ${subcmd}" >&2
      echo "Available: list, get, create, update, delete, on, off, status, rollout" >&2
      return 1
      ;;
  esac
}

# ─── Usage ────────────────────────────────────────────────────────────────────

usage() {
  cat >&2 <<'EOF'
LaunchDarkly CLI

Usage: ld.sh [global-flags] <command> [args]

Global flags:
  --profile <name>       Use a specific profile (overrides active profile)
  --api-key <token>      Override API token
  --environment <env>    Override environment
  --project <key>        Override project key (default: "default")

Profile management:
  config create <name> --api-key <token> [--environment <env>] [--project <key>]
  config set profile <name>            Set active profile
  config set environment <env>         Update active profile's defaultEnvironment
  config get profile                   Show active profile (apiKey redacted)
  config list                          List all profiles
  config delete <name>                 Delete a profile

Commands:
  me                                   Get caller identity (auth check)

  project list                         List all projects
  project get [<key>]                  Get project details (defaults to active project)

  environment list [--project <key>]   List environments for a project

  flag list [--project <k>] [--env <e>] [--tag <t>] [--limit <n>]
  flag get <key> [--project <k>]
  flag create --key <k> --name <n> [--description <d>] [--kind boolean|multivariate]
              [--variations <json-array>] [--tag <t>]... [--temporary] [--project <k>]
  flag update <key> [--name <n>] [--description <d>] [--add-tag <t>] [--remove-tag <t>]
  flag delete <key> [--project <k>]
  flag on <key>  [--env <env>] [--project <k>] [--comment <text>]
  flag off <key> [--env <env>] [--project <k>] [--comment <text>]
  flag status <key> [--env <env>] [--project <k>]
  flag rollout <key> --percentage <0-100> [--env <env>] [--project <k>]

Auth resolution: per-command flags > env vars > active profile

Env vars:  LAUNCHDARKLY_API_TOKEN, LAUNCHDARKLY_ENVIRONMENT, LAUNCHDARKLY_PROJECT_KEY
Profiles:  ~/.config/launchdarkly/<name>.json  (active stored in ~/.config/launchdarkly/current)
EOF
}

# ─── Main Dispatch ────────────────────────────────────────────────────────────

# Parse global flags before command. --profile temporarily sets active profile.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      if profile_exists "$2"; then
        _PROFILE_OVERRIDE="$2"
      else
        echo "Error: Profile '$2' does not exist." >&2; exit 1
      fi
      shift 2
      ;;
    --api-key)     _API_KEY="$2"; shift 2 ;;
    --environment) _ENVIRONMENT="$2"; shift 2 ;;
    --project)     _PROJECT_KEY="$2"; shift 2 ;;
    *) break ;;
  esac
done

if [[ $# -eq 0 ]]; then
  usage
  exit 0
fi

command="$1"
shift

case "$command" in
  me)             cmd_me "$@" ;;
  config)         cmd_config "$@" ;;
  project)        cmd_project "$@" ;;
  environment)    cmd_environment "$@" ;;
  flag)           cmd_flag "$@" ;;
  help|--help|-h) usage ;;
  *)              echo "Unknown command: $command" >&2; usage; exit 1 ;;
esac
