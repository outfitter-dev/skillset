# Build once, then pass the resulting immutable image digest to dagger-spike.ts.
ARG BASE_IMAGE=oven/bun@sha256:c9fe19a321fbb41877b26e9532e27951677abedb0a1ddd1e3ea0843c98acdfaf
FROM ${BASE_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git bash ca-certificates curl unzip tar nodejs npm python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# bootstrap.sh appends standard command directories. Keep Bun outside them,
# like setup-bun's user install, so cold-bootstrap fixtures exercise installation.
RUN mkdir -p /opt/skillset-bun/bin \
    && cp -L /usr/local/bin/bun /opt/skillset-bun/bin/bun \
    && rm -f /usr/bin/bun /usr/bin/bunx /bin/bun /bin/bunx /usr/local/bin/bun /usr/local/bin/bunx \
    && ln -sf bun /opt/skillset-bun/bin/bunx
ENV PATH="/opt/skillset-bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
RUN test "$(bun --version)" = "1.4.0"
