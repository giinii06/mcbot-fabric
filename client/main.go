package main

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

//go:embed mods.lock.json
var lockJSON []byte

var serverAddress string // Set by the release build.
var client = &http.Client{Timeout: 15 * time.Minute}
var hostPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]*$`)

const profileName = "Cobblemon Server"

type mod struct {
	File, URL, SHA256 string
	Size              int64
}

func main() {
	macDialog := runtime.GOOS == "darwin" && !(len(os.Args) == 2 && os.Args[1] == "--cli")
	if macDialog {
		_ = exec.Command("/usr/bin/osascript", "-e",
			`display notification "모드를 설치하는 중입니다. 완료 화면이 표시될 때까지 기다려 주세요." with title "Cobblemon Server"`).Run()
	}
	err := run()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Installation failed:", err)
	} else {
		fmt.Println("Installed. Open Minecraft Launcher > Java Edition > Installations > Cobblemon Server.")
		fmt.Println("Click Play, then select Cobblemon Server in Multiplayer.")
	}
	if macDialog {
		message := "설치가 완료되었습니다. Minecraft Launcher의 설치 설정에서 Cobblemon Server를 실행한 뒤 멀티플레이에서 서버에 접속하세요."
		if err != nil {
			message = "설치에 실패했습니다.\n\n" + err.Error()
		}
		dialog := `on run argv
			display dialog (item 1 of argv) with title "Cobblemon Server" buttons {"확인"} default button 1
		end run`
		if dialogErr := exec.Command("/usr/bin/osascript", "-e", dialog, message).Run(); dialogErr != nil {
			fmt.Fprintln(os.Stderr, dialogErr)
		}
	} else if info, err := os.Stdin.Stat(); runtime.GOOS == "windows" && err == nil && info.Mode()&os.ModeCharDevice != 0 {
		fmt.Print("Press Enter to close.")
		_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	}
	if err != nil {
		os.Exit(1)
	}
}

func run() error {
	if runtime.GOOS == "darwin" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		err = exec.Command("/usr/bin/pgrep", "-U", strconv.Itoa(os.Getuid()), "-if",
			`Minecraft( Launcher)?\.app/Contents/|(^|/)minecraft-launcher( |$)`).Run()
		if err == nil {
			return errors.New("Minecraft Launcher를 완전히 종료한 다음 설치 앱을 다시 여세요.")
		}
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 1 {
			return fmt.Errorf("check Minecraft Launcher: %w", err)
		}
		return install(filepath.Join(home, "Library", "Application Support", "minecraft"), serverAddress)
	}

	appData := os.Getenv("APPDATA")
	if appData == "" {
		return errors.New("APPDATA is missing")
	}
	processes, err := exec.Command("tasklist.exe", "/FO", "CSV", "/NH").Output()
	if err != nil {
		return fmt.Errorf("check Minecraft Launcher: %w", err)
	}
	for _, name := range []string{`"minecraftlauncher.exe",`, `"minecraft.exe",`} {
		if strings.Contains(strings.ToLower(string(processes)), name) {
			return errors.New("close Minecraft Launcher and run this installer again")
		}
	}
	return install(filepath.Join(appData, ".minecraft"), serverAddress)
}

func install(root, address string) error {
	host, port, err := net.SplitHostPort(address)
	portNumber, portErr := strconv.Atoi(port)
	if err != nil || len(address) > 260 || portErr != nil || portNumber < 1 || portNumber > 65535 ||
		(net.ParseIP(host) == nil && !hostPattern.MatchString(host)) {
		return errors.New("invalid configured Minecraft server address (expected host:port)")
	}

	var lock struct {
		SchemaVersion int
		Minecraft     struct{ Version, Loader, LoaderVersion string }
		Mods          []mod
	}
	if err := json.Unmarshal(lockJSON, &lock); err != nil {
		return err
	}
	if lock.SchemaVersion != 1 || lock.Minecraft.Loader != "fabric" || len(lock.Mods) == 0 {
		return errors.New("unsupported Fabric mod lock")
	}
	version := lock.Minecraft.Version
	loader := lock.Minecraft.LoaderVersion
	versionID := "fabric-loader-" + loader + "-" + version
	packHash := sha256.Sum256(lockJSON)
	gameDir := filepath.Join(root, "mcbot-cobblemon-"+hex.EncodeToString(packHash[:6]))

	timestamp := time.Now().UTC().Format(time.RFC3339)
	entry, err := json.Marshal(map[string]string{
		"name": profileName, "type": "custom", "lastVersionId": versionID,
		"gameDir": gameDir, "icon": "Grass", "created": timestamp, "lastUsed": timestamp,
	})
	if err != nil {
		return err
	}
	var profiles []string
	for _, file := range []string{"launcher_profiles.json", "launcher_profiles_microsoft_store.json"} {
		path := filepath.Join(root, file)
		_, err := updateProfile(path, entry)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		profiles = append(profiles, path)
	}
	if len(profiles) == 0 {
		return errors.New("open the official Minecraft Launcher and sign in to Java Edition once, then close it and retry")
	}

	fmt.Printf("Installing Fabric %s for Minecraft %s\n", loader, version)
	profileURL := "https://meta.fabricmc.net/v2/versions/loader/" + version + "/" + loader + "/profile/json"
	var fabricJSON bytes.Buffer
	if err := download(profileURL, &fabricJSON, 1<<20); err != nil {
		return err
	}
	var fabric struct {
		ID, InheritsFrom string
	}
	if err := json.Unmarshal(fabricJSON.Bytes(), &fabric); err != nil ||
		fabric.ID != versionID || fabric.InheritsFrom != version {
		return errors.New("Fabric returned an unexpected launcher profile")
	}
	if err := write(filepath.Join(root, "versions", versionID, versionID+".json"), fabricJSON.WriteTo); err != nil {
		return err
	}
	for _, mod := range lock.Mods {
		if err := installMod(filepath.Join(gameDir, "mods"), mod); err != nil {
			return fmt.Errorf("%s: %w", mod.File, err)
		}
	}

	serversPath := filepath.Join(gameDir, "servers.dat")
	// shortcut: preserve the entire server list on reinstall, add an NBT merge if server addresses need in-place migration.
	if _, err := os.Stat(serversPath); errors.Is(err, os.ErrNotExist) {
		serverList := serverNBT(address)
		if err := write(serversPath, bytes.NewReader(serverList).WriteTo); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	for _, path := range profiles {
		// Merge the latest launcher data after the downloads complete.
		data, err := updateProfile(path, entry)
		if err != nil {
			return err
		}
		if err := write(path, bytes.NewReader(data).WriteTo); err != nil {
			return err
		}
	}
	return nil
}

func updateProfile(path string, entry json.RawMessage) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var launcher, profiles map[string]json.RawMessage
	if err := json.Unmarshal(raw, &launcher); err != nil || launcher == nil {
		return nil, fmt.Errorf("invalid launcher settings: %s", path)
	}
	if rawProfiles := launcher["profiles"]; rawProfiles != nil {
		if err := json.Unmarshal(rawProfiles, &profiles); err != nil {
			return nil, fmt.Errorf("invalid launcher profiles: %w", err)
		}
	}
	if profiles == nil {
		profiles = make(map[string]json.RawMessage)
	}
	profiles["mcbot-cobblemon"] = entry
	launcher["profiles"], err = json.Marshal(profiles)
	if err != nil {
		return nil, err
	}
	return json.MarshalIndent(launcher, "", "  ")
}

func serverNBT(address string) []byte {
	// An uncompressed NBT root compound with one entry in the servers list.
	out := bytes.NewBuffer([]byte{10, 0, 0, 9, 0, 7})
	out.WriteString("servers")
	out.Write([]byte{10, 0, 0, 0, 1})
	for _, field := range [][2]string{{"name", profileName}, {"ip", address}} {
		out.WriteByte(8)
		for _, value := range field {
			out.Write(binary.BigEndian.AppendUint16(nil, uint16(len(value))))
			out.WriteString(value)
		}
	}
	out.Write([]byte{0, 0})
	return out.Bytes()
}

func installMod(dir string, mod mod) error {
	if !filepath.IsLocal(mod.File) || mod.File != filepath.Base(mod.File) ||
		filepath.Ext(mod.File) != ".jar" || mod.Size < 1 ||
		!strings.HasPrefix(mod.URL, "https://cdn.modrinth.com/data/") {
		return errors.New("invalid locked mod")
	}
	path := filepath.Join(dir, mod.File)
	if file, err := os.Open(path); err == nil {
		hash := sha256.New()
		size, err := io.Copy(hash, io.LimitReader(file, mod.Size+1))
		file.Close()
		if err == nil && size == mod.Size && hex.EncodeToString(hash.Sum(nil)) == mod.SHA256 {
			return nil
		}
	}
	fmt.Println("Downloading", mod.File)
	return write(path, func(out io.Writer) (int64, error) {
		hash := sha256.New()
		if err := download(mod.URL, io.MultiWriter(out, hash), mod.Size); err != nil {
			return 0, err
		}
		if hex.EncodeToString(hash.Sum(nil)) != mod.SHA256 {
			return 0, errors.New("SHA256 mismatch")
		}
		return mod.Size, nil
	})
}

func download(url string, out io.Writer, limit int64) error {
	response, err := client.Get(url)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("%s returned HTTP %d", url, response.StatusCode)
	}
	size, err := io.Copy(out, io.LimitReader(response.Body, limit+1))
	if err == nil && size > limit {
		return errors.New("download exceeded expected size")
	}
	return err
}

func write(path string, content func(io.Writer) (int64, error)) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".mcbot-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := content(file)
	closeErr := file.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
