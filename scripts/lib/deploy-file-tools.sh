#!/usr/bin/env bash

# Shared file operations for constrained Z.com hosting. This library avoids
# process substitution and does not require /dev/fd, rsync, or root access.

nathee_validate_relative_path() {
  local relative_path="${1:-}"
  [[ -n "$relative_path" ]] || return 1
  case "$relative_path" in
    .|/*|../*|*/../*|*/..|*\\*|*[!A-Za-z0-9._/-]*) return 1 ;;
  esac
}

nathee_make_temp_dir() {
  local label="$1"
  local parent="${NATHEE_TEMP_PARENT:-${TMPDIR:-/tmp}}"
  local candidate counter timestamp
  mkdir -p "$parent" || return 1

  if [[ "${NATHEE_DISABLE_MKTEMP:-0}" != "1" ]] && command -v mktemp >/dev/null 2>&1; then
    mktemp -d "$parent/${label}.XXXXXX" && return 0
  fi

  timestamp="$(date -u +%Y%m%d%H%M%S)"
  counter=0
  while [[ $counter -lt 100 ]]; do
    candidate="$parent/${label}.${timestamp}.$$.$counter"
    if (umask 077 && mkdir "$candidate") 2>/dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
    counter=$((counter + 1))
  done
  return 1
}

nathee_make_temp_file() {
  local parent="$1"
  local label="$2"
  local candidate counter timestamp
  mkdir -p "$parent" || return 1

  if [[ "${NATHEE_DISABLE_MKTEMP:-0}" != "1" ]] && command -v mktemp >/dev/null 2>&1; then
    mktemp "$parent/${label}.XXXXXX" && return 0
  fi

  timestamp="$(date -u +%Y%m%d%H%M%S)"
  counter=0
  while [[ $counter -lt 100 ]]; do
    candidate="$parent/${label}.${timestamp}.$$.$counter"
    if (set -o noclobber; umask 077; : > "$candidate") 2>/dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
    counter=$((counter + 1))
  done
  return 1
}

nathee_acquire_lock_dir() {
  local lock_dir="$1"
  [[ -n "$lock_dir" && ! -e "$lock_dir" && ! -L "$lock_dir" ]] || return 1
  if ! (umask 077 && mkdir "$lock_dir") 2>/dev/null; then
    return 1
  fi
  if ! printf '%s\n' "$$" > "$lock_dir/owner.pid"; then
    rmdir "$lock_dir" 2>/dev/null || true
    return 1
  fi
}

nathee_release_lock_dir() {
  local lock_dir="$1"
  local owner_pid
  [[ -d "$lock_dir" && ! -L "$lock_dir" ]] || return 1
  [[ -f "$lock_dir/owner.pid" && ! -L "$lock_dir/owner.pid" ]] || return 1
  IFS= read -r owner_pid < "$lock_dir/owner.pid" || return 1
  [[ "$owner_pid" == "$$" ]] || return 1
  rm -f "$lock_dir/owner.pid" || return 1
  rmdir "$lock_dir"
}

nathee_write_file_manifest() {
  local root="$1"
  local output="$2"
  [[ -d "$root" ]] || return 1
  (
    cd "$root" || exit 1
    find . -type f -exec sha256sum {} \;
  ) > "$output"
}

nathee_verify_file_manifest() {
  local root="$1"
  local manifest="$2"
  [[ -d "$root" && -s "$manifest" ]] || return 1
  (
    cd "$root" || exit 1
    sha256sum -c "$manifest"
  )
}

nathee_write_release_list() {
  local root="$1"
  local output="$2"
  [[ -d "$root" ]] || return 1
  (
    cd "$root" || exit 1
    find . -type f -print
  ) > "$output"
}

nathee_assert_safe_tree() (
  local root="$1"
  local temporary_dir file_list item relative_path
  [[ -d "$root" ]] || return 1
  temporary_dir="$(nathee_make_temp_dir nathee-tree-check)" || return 1
  trap 'rm -rf "$temporary_dir"' EXIT
  file_list="$temporary_dir/files.txt"
  nathee_write_release_list "$root" "$file_list" || return 1
  [[ -s "$file_list" ]] || return 1

  while IFS= read -r item || [[ -n "$item" ]]; do
    relative_path="${item#./}"
    nathee_validate_relative_path "$relative_path" || return 1
    [[ -f "$root/$relative_path" && ! -L "$root/$relative_path" ]] || return 1
  done < "$file_list"
)

nathee_assert_safe_destination_path() {
  local root="$1"
  local relative_path="$2"
  local current_path="$root"
  local parent_path path_part
  nathee_validate_relative_path "$relative_path" || return 1
  parent_path="${relative_path%/*}"
  if [[ "$parent_path" == "$relative_path" ]]; then
    parent_path=""
  fi

  while [[ -n "$parent_path" ]]; do
    path_part="${parent_path%%/*}"
    [[ -n "$path_part" ]] || return 1
    current_path="$current_path/$path_part"
    [[ ! -L "$current_path" ]] || return 1
    if [[ -e "$current_path" && ! -d "$current_path" ]]; then
      return 1
    fi
    if [[ "$parent_path" == */* ]]; then
      parent_path="${parent_path#*/}"
    else
      parent_path=""
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
  destination_dir="$(dirname "$destination_file")"
  mkdir -p "$destination_dir" || return 1

  if [[ -L "$destination_file" || ( -e "$destination_file" && ! -f "$destination_file" ) ]]; then
    return 1
  fi

  temporary_file="$(nathee_make_temp_file "$destination_dir" ".nathee-${deploy_token}")" || return 1
  if ! cp -p "$source_file" "$temporary_file"; then
    rm -f "$temporary_file"
    return 1
  fi

  source_sha="$(sha256sum "$source_file" | cut -d ' ' -f 1)"
  copied_sha="$(sha256sum "$temporary_file" | cut -d ' ' -f 1)"
  if [[ "$source_sha" != "$copied_sha" ]]; then
    rm -f "$temporary_file"
    return 1
  fi

  if ! mv -f "$temporary_file" "$destination_file"; then
    rm -f "$temporary_file"
    return 1
  fi
}

nathee_create_backup() {
  local production_root="$1"
  local backup_dir="$2"
  [[ -d "$production_root" ]] || return 1
  if find "$production_root" -type l -print | grep -q .; then
    return 1
  fi
  mkdir -p "$backup_dir/snapshot" || return 1

  tar -C "$production_root" -cpf "$backup_dir/production.tar" . || return 1
  (
    cd "$backup_dir" || exit 1
    sha256sum production.tar > production.tar.sha256
  ) || return 1
  tar -C "$backup_dir/snapshot" -xpf "$backup_dir/production.tar" || return 1
  nathee_write_file_manifest "$backup_dir/snapshot" "$backup_dir/SHA256SUMS.txt" || return 1
  nathee_verify_file_manifest "$backup_dir/snapshot" "$backup_dir/SHA256SUMS.txt" || return 1
  (
    cd "$backup_dir" || exit 1
    sha256sum -c production.tar.sha256
  )
}

nathee_stage_tree() {
  local source_root="$1"
  local stage_root="$2"
  [[ -d "$source_root" && -d "$stage_root" ]] || return 1
  tar -C "$source_root" -cpf - . | tar -C "$stage_root" -xpf -
}

nathee_write_created_manifest() (
  local release_root="$1"
  local production_root="$2"
  local output="$3"
  local temporary_dir file_list item relative_path
  temporary_dir="$(nathee_make_temp_dir nathee-created-list)" || return 1
  trap 'rm -rf "$temporary_dir"' EXIT
  file_list="$temporary_dir/files.txt"
  nathee_write_release_list "$release_root" "$file_list" || return 1
  : > "$output"

  while IFS= read -r item || [[ -n "$item" ]]; do
    relative_path="${item#./}"
    nathee_validate_relative_path "$relative_path" || return 1
    nathee_assert_safe_destination_path "$production_root" "$relative_path" || return 1
    if [[ ! -e "$production_root/$relative_path" && ! -L "$production_root/$relative_path" ]]; then
      printf '%s\n' "$relative_path" >> "$output"
    fi
  done < "$file_list"
)

nathee_finalize_backup_metadata() {
  local backup_dir="$1"
  local required_file
  for required_file in production.tar.sha256 SHA256SUMS.txt RELEASE_SHA256SUMS.txt CREATED_FILES.txt; do
    [[ -f "$backup_dir/$required_file" ]] || return 1
  done
  (
    cd "$backup_dir" || exit 1
    sha256sum production.tar.sha256 SHA256SUMS.txt RELEASE_SHA256SUMS.txt CREATED_FILES.txt \
      > DEPLOY_METADATA_SHA256SUMS.txt
  )
}

nathee_verify_backup_metadata() {
  local backup_dir="$1"
  [[ -s "$backup_dir/DEPLOY_METADATA_SHA256SUMS.txt" ]] || return 1
  (
    cd "$backup_dir" || exit 1
    sha256sum -c DEPLOY_METADATA_SHA256SUMS.txt
  )
}

nathee_assert_safe_apply_destinations() (
  local release_root="$1"
  local production_root="$2"
  local temporary_dir file_list item relative_path
  nathee_assert_safe_tree "$release_root" || return 1
  temporary_dir="$(nathee_make_temp_dir nathee-destination-check)" || return 1
  trap 'rm -rf "$temporary_dir"' EXIT
  file_list="$temporary_dir/files.txt"
  nathee_write_release_list "$release_root" "$file_list" || return 1

  while IFS= read -r item || [[ -n "$item" ]]; do
    relative_path="${item#./}"
    nathee_assert_safe_destination_path "$production_root" "$relative_path" || return 1
  done < "$file_list"
)

nathee_apply_tree() (
  local release_root="$1"
  local production_root="$2"
  local deploy_token="$3"
  local temporary_dir file_list item relative_path
  nathee_assert_safe_apply_destinations "$release_root" "$production_root" || return 1
  temporary_dir="$(nathee_make_temp_dir nathee-apply-list)" || return 1
  trap 'rm -rf "$temporary_dir"' EXIT
  file_list="$temporary_dir/files.txt"
  nathee_write_release_list "$release_root" "$file_list" || return 1

  while IFS= read -r item || [[ -n "$item" ]]; do
    relative_path="${item#./}"
    nathee_atomic_copy_file \
      "$release_root/$relative_path" \
      "$production_root/$relative_path" \
      "$deploy_token" || return 1
  done < "$file_list"
)

nathee_restore_backup() (
  local backup_dir="$1"
  local production_root="$2"
  local relative_path
  [[ -d "$backup_dir/snapshot" ]] || return 1
  [[ -s "$backup_dir/SHA256SUMS.txt" ]] || return 1
  [[ -f "$backup_dir/production.tar" ]] || return 1
  [[ -s "$backup_dir/production.tar.sha256" ]] || return 1
  [[ -f "$backup_dir/CREATED_FILES.txt" ]] || return 1
  [[ -d "$production_root" ]] || return 1

  nathee_verify_backup_metadata "$backup_dir" || return 1
  (
    cd "$backup_dir" || exit 1
    sha256sum -c production.tar.sha256
  ) || return 1
  nathee_verify_file_manifest "$backup_dir/snapshot" "$backup_dir/SHA256SUMS.txt" || return 1

  # Refuse to restore through symlinks. The backup was also created only after
  # confirming that Production contained no symlinks.
  if find "$production_root" -type l -print | grep -q .; then
    return 1
  fi

  # Validate the complete deletion list before removing even one file.
  while IFS= read -r relative_path || [[ -n "$relative_path" ]]; do
    [[ -n "$relative_path" ]] || continue
    nathee_validate_relative_path "$relative_path" || return 1
    nathee_assert_safe_destination_path "$production_root" "$relative_path" || return 1
  done < "$backup_dir/CREATED_FILES.txt"

  # Remove only files that this exact release created after the backup.
  while IFS= read -r relative_path || [[ -n "$relative_path" ]]; do
    [[ -n "$relative_path" ]] || continue
    if [[ -f "$production_root/$relative_path" || -L "$production_root/$relative_path" ]]; then
      rm -f "$production_root/$relative_path"
    elif [[ -e "$production_root/$relative_path" ]]; then
      return 1
    fi
  done < "$backup_dir/CREATED_FILES.txt"

  # Overlay the checksum-verified archive. This restores the complete snapshot
  # without deleting unrelated files created after deployment.
  tar -C "$production_root" -xpf "$backup_dir/production.tar" || return 1
  nathee_verify_file_manifest "$production_root" "$backup_dir/SHA256SUMS.txt"
)
