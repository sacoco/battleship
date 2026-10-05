# Two stages: compile with the full Go toolchain, ship only the static binary.
# Builds natively on whatever machine runs it (amd64, arm64).
FROM golang:1 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /battleship .

FROM scratch
COPY --from=build /battleship /battleship
USER 65534:65534
EXPOSE 8080
ENTRYPOINT ["/battleship"]
