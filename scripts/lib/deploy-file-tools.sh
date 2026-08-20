#!/usr/bin/env bash

# Shared, dependency-light file operations for the Z.com deployment scripts.
# Callers must enable `set -Eeuo pipefail` before sourcing this file.

nathee_validate_relative_path() {
  local relative_path="${1:-}"
  [[ -n "$relative_path" ]] || return 1
  [[ "$relative_path" != *$'\n'* ]] || return 1
  [[ "$relative_path" != *$'\r'* ]] || return 1
  case "$relative_path" in
    .|/*|../*|*/../*|*/..|*\\*) return 1 ;;
  esac
}

nathee_write_file_manifest() {
  local root="$1"
  local output="$2"
  [[ -d "$root" ]] || return 1
  (
    cd -- "$root"
    while IFS= read -r -d '' item; do
      sha256sum -- "$item"
    done < <(find . -type f -print0)
  ) > "$output"
}

nathee_verify_file_manifest() {
  local root="$1"
  local manifest="$2"
  [[ -d "$root" && -s "$manifest" ]] || return 1
  (
    cd -- "$root"
    sha256sum --check --strict "$manifest"
  )
}

nathee_assert_safe_tree() {
  local root="$1"
  local found_file=0
  local item relative_path
  [[ -d "$root" ]] || return 1

  while IFS= read -r -d '' item; do
    found_file=1
    relative_path="${item#./}"
    nathee_validate_relative_path "$relative_path" || return 1
  done < <(cd -- "$root" && find . -type f -print0)

  [[ $found_file -eq 1 ]]
}

nathee_assert_safe_destination_path() {
  local root="$1"
  local relative_path="$2"
  local current_path="$root"
  local index
  local -a path_parts
  nathee_validate_relative_path "$relative_path" || return 1
  IFS='/' read -r -a path_parts <<< "$relative_path"

  for ((index = 0; index < ${#path_parts[@]} - 1; index += 1)); do
    [[ -n "${path_parts[$index]}" ]] || return 1
    current_path="$current_path/${path_parts[$index]}"
    [[ ! -L "$current_path" ]] || return 1
    if [[ -e "$current_path" && ! -d "$current_path" ]]; then
      return 1
    fi
  done

  [[ ! -L "$root/$relative_path" ]]
}

nathee_atomic_copy_file() {
  local source_file="$1"
  local destination_file="$2"
  local deploy_token="$3"
  local destination_dir temporary_file source_sha copied_sha

  [[ -f "$source_file" && ! -L "$source_file" ]] || return 1
  destination_dir="$(dirname -- "$destination_file")"
  mkdir -p -- "$destination_dir"

  if [[ -L "$destination_file" || ( -e "$destination_file" && ! -f "$destination_file" ) ]]; then
    return 1
  fi

  temporary_file="$(mktemp "$destination_dir/.nathee-${deploy_token}.XXXXXX")"
  if ! cp -p -- "$source_file" "$temporary_file"; then
    rm -f -- "$temporary_file"
    return 1
  fi

  source_sha="$(sha256sum "$source_file" | cut -d ' ' -f 1)"
  copied_sha="$(sha256sum "$temporary_file" | cut -d ' ' -f 1)"
  if [[ "$source_sha" != "$copied_sha" ]]; then
    rm -f -- "$temporary_file"
    return 1
  fi

  if ! mv -f -- "$temporary_file" "$destination_file"; then
    rm -f -- "$temporary_file"
    return 1
  fi
}

nathee_create_backup() {
  local production_root="$1"
  local backup_dir="$2"
  [[ -d "$production_root" ]] || return 1
  if find "$production_root" -type l -print -quit | grep -q .; then
    return 1
  fi
  mkdir -p -- "$backup_dir/snapshot"

  tar -C "$production_root" -cpf "$backup_dir/production.tar" .
  (
    cd -- "$backup_dir"
    sha256sum production.tar > production.tar.sha256
  )
  tar -C "$backup_dir/snapshot" -xpf "$backup_dir/production.tar"
  nathee_write_file_manifest "$backup_dir/snapshot" "$backup_dir/SHA256SUMS.txt"
  nathee_verify_file_manifest "$backup_dir/snapshot" "$backup_dir/SHA256SUMS.txt"
  (
    cd -- "$backup_dir"
    sha256sum --check --strict production.tar.sha256
  )
}

nathee_stage_tree() {
  local source_root="$1"
  local stage_root="$2"
  [[ -d "$source_root" && -d "$stage_root" ]] || return 1
  tar -C "$source_root" -cpf - . | tar -C "$stage_root" -xpf -
}

nathee_write_created_manifest() {
  local release_root="$1"
  local production_root="$2"
  local output="$3"
  local item relative_path
  : > "$output"

  while IFS= read -r -d '' item; do
    relative_path="${item#./}"
    nathee_validate_relative_path "$relative_path" || return 1
    nathee_assert_safe_destination_path "$production_root" "$relative_path" || return 1
    if [[ ! -e "$production_root/$relative_path" && ! -L "$production_root/$relative_path" ]]; then
      printf '%s\n' "$relative_path" >> "$output"
    fi
  done < <(cd -- "$release_root" && find . -type f -print0)
}

nathee_finalize_backup_metadata() {
  local backup_dir="$1"
  for required_file in \
    production.tar.sha256 \
    SHA256SUMS.txt \
    RELEASE_SHA256SUMS.txt \
    CREATED_FILES.txt; do
    [[ -f "$backup_dir/$required_file" ]] || return 1
  done
  (
    cd -- "$backup_dir"
    sha256sum \
      production.tar.sha256 \
      SHA256SUMS.txt \
      RELEASE_SHA256SUMS.txt \
      CREATED_FILES.txt > DEPLOY_METADATA_SHA256SUMS.txt
  )
}

nathee_verify_backup_metadata() {
  local backup_dir="$1"
  [[ -s "$backup_dir/DEPLOY_METADATA_SHA256SUMS.txt" ]] || return 1
  (
    cd -- "$backup_dir"
    sha256sum --check --strict DEPLOY_METADATA_SHA256SUMS.txt
  )
}

nathee_assert_safe_apply_destinations() {
  local release_root="$1"
  local production_root="$2"
  local item relative_path
  nathee_assert_safe_tree "$release_root" || return 1

  while IFS= read -r -d '' item; do
    relative_path="${item#./}"
    nathee_assert_safe_destination_path "$production_root" "$relative_path" || return 1
  done < <(cd -- "$release_root" && find . -type f -print0)
}

nathee_apply_tree() {
  local release_root="$1"
  local production_root="$2"
  local deploy_token="$3"
  local item relative_path
  nathee_assert_safe_apply_destinations "$release_root" "$production_root" || return 1

  while IFS= read -r -d '' item; do
    relative_path="${item#./}"
    nathee_validate_relative_path "$relative_path" || return 1
    nathee_assert_safe_destination_path "$production_root" "$relative_path" || return 1
    nathee_atomic_copy_file \
      "$release_root/$relative_path" \
      "$production_root/$relative_path" \
      "$deploy_token" || return 1
  done < <(cd -- "$release_root" && find . -type f -print0)
}

nathee_restore_backup() (
  local backup_dir="$1"
  local production_root="$2"
  local relative_path restore_stage
  [[ -d "$backup_dir/snapshot" ]] || return 1
  [[ -s "$backup_dir/SHA256SUMS.txt" ]] || return 1
  [[ -f "$backup_dir/production.tar" ]] || return 1
  [[ -s "$backup_dir/production.tar.sha256" ]] || return 1
  [[ -f "$backup_dir/CREATED_FILES.txt" ]] || return 1
  [[ -d "$production_root" ]] || return 1

  nathee_verify_backup_metadata "$backup_dir" || return 1
  (
    cd -- "$backup_dir"
    sha256sum --check --strict production.tar.sha256
  ) || return 1
  nathee_verify_file_manifest "$backup_dir/snapshot" "$backup_dir/SHA256SUMS.txt" || return 1

  restore_stage="$(mktemp -d "$backup_dir/.restore.XXXXXX")"
  trap 'rm -rf -- "$restore_stage"' EXIT
  tar -C "$restore_stage" -xpf "$backup_dir/production.tar" || return 1
  nathee_verify_file_manifest "$restore_stage" "$backup_dir/SHA256SUMS.txt" || return 1
  nathee_assert_safe_apply_destinations "$restore_stage" "$production_root" || return 1

  # Validate the complete deletion list before removing even one file.
  while IFS= read -r relative_path || [[ -n "$relative_path" ]]; do
    [[ -n "$relative_path" ]] || continue
    nathee_validate_relative_path "$relative_path" || return 1
    nathee_assert_safe_destination_path "$production_root" "$relative_path" || return 1
  done < "$backup_dir/CREATED_FILES.txt"

  # Remove only files that this exact release created after the backup. Files
  # not named in CREATED_FILES.txt are never deleted by rollback.
  while IFS= read -r relative_path || [[ -n "$relative_path" ]]; do
    [[ -n "$relative_path" ]] || continue
    nathee_validate_relative_path "$relative_path" || return 1
    nathee_assert_safe_destination_path "$production_root" "$relative_path" || return 1
    if [[ -f "$production_root/$relative_path" || -L "$production_root/$relative_path" ]]; then
      rm -f -- "$production_root/$relative_path"
    elif [[ -e "$production_root/$relative_path" ]]; then
      return 1
    fi
  done < "$backup_dir/CREATED_FILES.txt"

  # Restore only files freshly extracted from the checksum-verified archive,
  # atomically. Unrelated files are not traversed for deletion.
  nathee_apply_tree "$restore_stage" "$production_root" rollback || return 1
  nathee_verify_file_manifest "$production_root" "$backup_dir/SHA256SUMS.txt"
)
