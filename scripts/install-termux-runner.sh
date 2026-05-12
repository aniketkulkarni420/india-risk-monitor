#!/data/data/com.termux/files/usr/bin/bash
# IRM Termux runner installer · Android phone as backup India runner.
#
# Setup (one-time, ~10 min on the Android device):
#
#   1. Install Termux from F-Droid (NOT Play Store — Play version is outdated)
#      https://f-droid.org/en/packages/com.termux/
#
#   2. Open Termux and run:
#      pkg update -y && pkg install -y curl
#      curl -fsSL https://raw.githubusercontent.com/aniketkulkarni420/india-risk-monitor/main/scripts/install-termux-runner.sh -o setup.sh
#      bash setup.sh
#
#   3. Get a registration token from:
#      https://github.com/aniketkulkarni420/india-risk-monitor/settings/actions/runners/new
#      (pick Linux arm64)
#      Paste it when this script prompts.
#
# The runner will register with labels: self-hosted, linux, india
# Combined with your Windows laptop runner (same 'india' label), GitHub
# Actions auto-distributes jobs across both.

set -e

REPO="https://github.com/aniketkulkarni420/india-risk-monitor"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_VERSION="2.319.1"

echo
echo "IRM Termux runner installer"
echo "==========================="
echo

# Install required packages
echo "[1/5] Installing packages (nodejs, git, dotnet helpers)..."
pkg update -y
pkg install -y nodejs-lts git wget tar

# Create runner dir
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

# Download runner
if [ ! -f "actions-runner.tar.gz" ]; then
  echo "[2/5] Downloading runner..."
  wget -q -O actions-runner.tar.gz "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-arm64-${RUNNER_VERSION}.tar.gz"
fi

# Extract
if [ ! -f "config.sh" ]; then
  echo "[3/5] Extracting..."
  tar xzf actions-runner.tar.gz
fi

# Prompt for token
echo "[4/5] Getting your registration token:"
echo "  Visit: https://github.com/aniketkulkarni420/india-risk-monitor/settings/actions/runners/new"
echo "  Choose Linux arm64 · copy the --token value"
echo
read -p "Paste token here: " TOKEN

# Configure
NAME="${HOSTNAME:-android}-irm"
./config.sh --unattended \
  --url "$REPO" \
  --token "$TOKEN" \
  --name "$NAME" \
  --labels "self-hosted,linux,india,arm64,backup" \
  --replace

# Start runner in background using nohup
echo "[5/5] Starting runner..."
nohup ./run.sh > runner.log 2>&1 &
RUNNER_PID=$!
echo
echo "Done. Runner '$NAME' is registered and running (PID $RUNNER_PID)."
echo
echo "To auto-start on Termux boot:"
echo "  1. Install Termux:Boot from F-Droid"
echo "  2. Create file: ~/.termux/boot/start-runner.sh"
echo "       #!/data/data/com.termux/files/usr/bin/bash"
echo "       cd $RUNNER_DIR && nohup ./run.sh > runner.log 2>&1 &"
echo "  3. chmod +x ~/.termux/boot/start-runner.sh"
echo "  4. Grant Termux 'Battery optimization · ignore' in Android settings"
echo
echo "Verify online at:"
echo "  https://github.com/aniketkulkarni420/india-risk-monitor/settings/actions/runners"
