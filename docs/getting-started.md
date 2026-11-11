# Getting started

This guide takes you from a fresh computer to Open ASL running on your own machine, on Windows, macOS or
Linux. No cloud account is needed: everything runs locally on the Firebase emulators.

You will install four things:

| Tool | Version | Why |
| --- | --- | --- |
| [Git](https://git-scm.com) | any recent | To download the code |
| [Node.js](https://nodejs.org) | 22 or newer | Runs the build, the tests and the dev server |
| [pnpm](https://pnpm.io) | 10 | Installs the packages (comes with Node through Corepack) |
| Java (JDK) | 21 or newer | The Firebase emulators run on Java |

Then you clone the repository, install, and start it. Jump to your system:

- [Windows](#windows)
- [macOS](#macos)
- [Linux](#linux)
- [Run Open ASL](#run-open-asl) (all systems)
- [Troubleshooting](#troubleshooting)

---

## Windows

Open **PowerShell** (press Start, type `PowerShell`, press Enter) and install the tools with `winget`, which
comes with Windows 10 and 11:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id EclipseAdoptium.Temurin.21.JDK -e
```

**Close PowerShell and open a new one** so it sees the new programs, then switch on pnpm:

```powershell
corepack enable
```

If `corepack enable` says access is denied, open PowerShell as administrator (right-click it, *Run as
administrator*) and run it again.

Check everything is there:

```powershell
git --version
node --version     # v22 or higher
pnpm --version     # 10.x
java -version      # 21 or higher
```

Now go to [Run Open ASL](#run-open-asl).

> **Prefer Linux tools?** Open ASL also works in [WSL 2](https://learn.microsoft.com/windows/wsl/install)
> (Ubuntu). Install WSL, open the Ubuntu terminal and follow the [Linux](#linux) steps instead. Keep the code
> inside the Linux file system (for example `~/code`), not under `/mnt/c`, or installs will be slow.

## macOS

Install [Homebrew](https://brew.sh) if you do not have it, by pasting the command from its home page into
**Terminal**. Then:

```bash
brew install git node@22 openjdk@21
corepack enable
```

Homebrew prints a line telling you how to put `openjdk@21` and `node@22` on your `PATH`; run what it
shows (on Apple silicon it is usually):

```bash
echo 'export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/openjdk@21/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

Check:

```bash
git --version
node --version     # v22 or higher
pnpm --version     # 10.x
java -version      # 21 or higher
```

Now go to [Run Open ASL](#run-open-asl).

## Linux

The simplest way to get the right Node version is [fnm](https://github.com/Schniz/fnm) (or nvm, if you
already use it).

**Debian / Ubuntu:**

```bash
sudo apt update
sudo apt install -y git curl unzip openjdk-21-jdk
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22 && fnm default 22
corepack enable
```

**Fedora:**

```bash
sudo dnf install -y git curl unzip java-21-openjdk
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22 && fnm default 22
corepack enable
```

**Arch:**

```bash
sudo pacman -S --needed git nodejs npm jdk21-openjdk
sudo corepack enable
```

If your distribution has no Java 21 package, install [Eclipse Temurin 21](https://adoptium.net).

Check:

```bash
git --version
node --version     # v22 or higher
pnpm --version     # 10.x
java -version      # 21 or higher
```

---

## Run Open ASL

These steps are the same everywhere. In your terminal:

```bash
git clone https://github.com/Open-ASL/open-asl.git
cd open-asl
pnpm install
pnpm dev
```

`pnpm install` downloads everything the project needs (a few minutes the first time). `pnpm dev` builds the
cloud functions, starts the Firebase emulators and starts the web app. Leave it running. When you see the
web app's address and the emulators report *All emulators ready*, it is up.

Open a **second terminal** in the same folder and create an account for yourself (use any address; nothing is
sent):

```bash
pnpm seed you@example.com
```

Open <http://localhost:5173>, click **Sign in**, and sign in with that address and the password `password`.
Pick a scenario and start a hotseat game.

To try online play on one computer, seed a second account (`pnpm seed friend@example.com`) and sign in with it
in a private browser window.

To stop everything, press `Ctrl+C` in the first terminal. The emulators save their data in `.emulator-data/`
when they stop, so your accounts and games are still there next time. `pnpm emulators:fresh` starts them
empty.

### Useful addresses while it runs

| Address | What |
| --- | --- |
| <http://localhost:5173> | The app |
| <http://localhost:4100> | The Firebase emulator UI: browse the database, the accounts and the function logs |

### Checks

Before you send a change, run:

```bash
pnpm typecheck
pnpm test
```

Both must pass. `pnpm test:watch` reruns the tests as you edit. The browser tests in `apps/web/e2e` drive the
running app with a headless Chrome; start `pnpm dev` first, then for example `pnpm test:e2e`.

### Your own scenario photographs

The free scenarios come with their card photographs. Any other images you are entitled to use can go in
`assets-local/` at the repository root (it is not tracked by git): `pnpm dev` serves
`assets-local/scenarios/<scenario id>.jpg` as that scenario's photograph (ahead of any committed one), and
`assets-local/audio/` for sound overrides (see `apps/web/audio-manifest.example.json`).

---

## Troubleshooting

**`java: command not found`, or the emulators fail to start.** Java is missing or too old. Install a JDK 21
as above, open a new terminal, and check `java -version`.

**`pnpm: command not found`.** Run `corepack enable` (as administrator on Windows, with `sudo` on some Linux
systems), then open a new terminal.

**`Port 8080 is not open` / `address already in use`.** Something else uses one of the emulator ports (5173,
4100, 5001, 8080, 9000, 9099, 9199). Stop it, or stop an old `pnpm dev` that is still running.

**The page loads but signing in fails.** Make sure `pnpm dev` is still running and showed *All emulators
ready*, and that you seeded the account with `pnpm seed`.

**Odd data after switching branches.** Stop `pnpm dev`, delete the `.emulator-data` folder, and start again.

**Still stuck?** Open an issue with what you ran, what you expected and the full error output.
