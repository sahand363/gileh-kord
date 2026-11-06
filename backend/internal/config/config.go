package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/sahand363/gileh-kord/backend/internal/currency"
)

type Config struct {
	ServerHost        string
	ServerPort        int
	ReadTimeout       time.Duration
	WriteTimeout      time.Duration
	IdleTimeout       time.Duration
	TLSCertFile       string
	TLSKeyFile        string
	DatabasePath      string
	BusyTimeoutMs     int
	MigrationsPath    string
	Timezone          string
	Location          *time.Location
	ReportingCurrency currency.Currency
	AllowedOrigins    []string
}

func Load(envFile string) (*Config, error) {
	if envFile != "" {
		_ = loadEnvFile(envFile)
	}

	tzName := getEnv("TIMEZONE", "Asia/Tehran")
	loc, err := time.LoadLocation(tzName)
	if err != nil {
		loc = time.FixedZone("Asia/Tehran", 3*3600+1800)
	}

	repCurr, err := currency.ParseCurrency(getEnv("REPORTING_CURRENCY", "TOMAN"))
	if err != nil {
		return nil, err
	}

	migrationsPath := getEnv("MIGRATIONS_PATH", "")
	if migrationsPath == "" {
		migrationsPath = resolveDefaultMigrationsPath()
	}

	cfg := &Config{
		ServerHost:        getEnv("SERVER_HOST", "0.0.0.0"),
		ServerPort:        getEnvInt("SERVER_PORT", 8080),
		ReadTimeout:       getEnvDuration("SERVER_READ_TIMEOUT", 15*time.Second),
		WriteTimeout:      getEnvDuration("SERVER_WRITE_TIMEOUT", 15*time.Second),
		IdleTimeout:       getEnvDuration("SERVER_IDLE_TIMEOUT", 60*time.Second),
		TLSCertFile:       getEnv("TLS_CERT_FILE", ""),
		TLSKeyFile:        getEnv("TLS_KEY_FILE", ""),
		DatabasePath:      getEnv("DATABASE_PATH", "./data/gileh_kord.db"),
		BusyTimeoutMs:     getEnvInt("DATABASE_BUSY_TIMEOUT", 5000),
		MigrationsPath:    migrationsPath,
		Timezone:          tzName,
		Location:          loc,
		ReportingCurrency: repCurr,
		AllowedOrigins: getEnvSlice("CORS_ALLOWED_ORIGINS", []string{
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:5173",
		}),
	}

	if (cfg.TLSCertFile != "" && cfg.TLSKeyFile == "") || (cfg.TLSCertFile == "" && cfg.TLSKeyFile != "") {
		return nil, fmt.Errorf("both TLS_CERT_FILE and TLS_KEY_FILE must be provided together to enable HTTPS")
	}

	return cfg, nil
}

func (c *Config) IsTLSEnabled() bool {
	return c.TLSCertFile != "" && c.TLSKeyFile != ""
}

func (c *Config) Address() string {
	return c.ServerHost + ":" + strconv.Itoa(c.ServerPort)
}

func resolveDefaultMigrationsPath() string {
	candidates := []string{"./migrations", "./backend/migrations", "../../migrations"}
	for _, path := range candidates {
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			return path
		}
	}
	return "./migrations"
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if parsed, err := strconv.Atoi(val); err == nil && parsed > 0 {
			return parsed
		}
	}
	return defaultVal
}

func getEnvDuration(key string, defaultVal time.Duration) time.Duration {
	if val := os.Getenv(key); val != "" {
		if parsed, err := time.ParseDuration(val); err == nil && parsed > 0 {
			return parsed
		}
	}
	return defaultVal
}

func getEnvSlice(key string, defaultVal []string) []string {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	parts := strings.Split(val, ",")
	var result []string
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	if len(result) == 0 {
		return defaultVal
	}
	return result
}

func loadEnvFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			k := strings.TrimSpace(parts[0])
			v := strings.TrimSpace(parts[1])
			v = strings.Trim(v, `"'`)
			if os.Getenv(k) == "" {
				_ = os.Setenv(k, v)
			}
		}
	}
	return scanner.Err()
}
