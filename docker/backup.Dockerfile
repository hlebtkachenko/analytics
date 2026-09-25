# syntax=docker/dockerfile:1.7

FROM restic/restic:0.19.1@sha256:136600b6ff6843d61d355f7f71f460a166429f35de6fd11b568fece3c9a4d510 AS restic

FROM postgres:18.6-bookworm@sha256:3725f4e2499eef5134592b3b4ab79a543ed7f8e533b05b5b637af926630f6650
COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY --chmod=0555 scripts/backup-stage-entrypoint.sh /usr/local/bin/backup-stage-entrypoint
COPY --chmod=0555 scripts/backup-entrypoint.sh /usr/local/bin/backup-entrypoint
COPY THIRD_PARTY_NOTICES.md /usr/share/doc/bap/THIRD_PARTY_NOTICES.md
COPY licenses /usr/share/doc/bap/licenses
RUN test "$(id -u postgres):$(id -g postgres)" = '999:999' && mkdir /repository && chown postgres:postgres /repository
USER root
ENTRYPOINT ["/usr/local/bin/backup-stage-entrypoint"]
