<?php
declare(strict_types=1);

/**
 * AKMS KeyManagement - PHP client
 * -------------------------------
 * Drop this single file into any PHP app to gate it behind an AKMS license.
 * Requires the openssl and curl extensions (standard on cPanel hosting).
 *
 *   require __DIR__ . '/akms-client.php';
 *
 *   $akms = new AKMSClient([
 *     'serverUrl'    => 'https://keys.example.com',
 *     'appSlug'      => 'my-app',         // omit for universal-only
 *     'publicKeyPem' => "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
 *     // 'statePath'  => __DIR__ . '/akms-state.json',  // where the token is cached
 *   ]);
 *
 *   if (!$akms->isLicensed()) {
 *       // First run: collect a key from the user, then:
 *       $res = $akms->activate('VINZ-XXXX-XXXX-XXXX-XXXX');
 *       if (empty($res['valid'])) { exit('License error: ' . ($res['message'] ?? 'unknown')); }
 *   }
 */
final class AKMSClient
{
    private string $serverUrl;
    private ?string $appSlug;
    private string $publicKeyPem;
    private string $statePath;
    private array $state;

    public function __construct(array $opts)
    {
        if (empty($opts['serverUrl']))    throw new InvalidArgumentException('serverUrl is required.');
        if (empty($opts['publicKeyPem'])) throw new InvalidArgumentException('publicKeyPem is required.');

        $this->serverUrl    = rtrim((string) $opts['serverUrl'], '/');
        $this->appSlug      = isset($opts['appSlug']) ? (string) $opts['appSlug'] : null;
        $this->publicKeyPem = (string) $opts['publicKeyPem'];
        $this->statePath    = (string) ($opts['statePath'] ?? (sys_get_temp_dir() . '/akms-state.json'));
        $this->state        = $this->loadState();

        if (!empty($opts['machineId'])) {
            $this->state['mid'] = (string) $opts['machineId'];
        }
    }

    /* ----------------------------- state ----------------------------- */
    private function loadState(): array
    {
        if (is_file($this->statePath)) {
            $raw = (string) @file_get_contents($this->statePath);
            $data = json_decode($raw, true);
            if (is_array($data)) return $data;
        }
        return [];
    }

    private function saveState(): void
    {
        @file_put_contents($this->statePath, json_encode($this->state, JSON_PRETTY_PRINT));
        @chmod($this->statePath, 0600);
    }

    /** Stable per-install machine identifier. */
    public function getMachineId(): string
    {
        if (empty($this->state['mid'])) {
            $this->state['mid'] = bin2hex(random_bytes(16));
            $this->saveState();
        }
        return (string) $this->state['mid'];
    }

    public function getLicenseKey(): ?string { return $this->state['key'] ?? null; }
    public function getToken(): ?string { return $this->state['token'] ?? null; }

    /* ------------------------------ http ----------------------------- */
    private function api(string $action, array $body): array
    {
        $ch = curl_init($this->serverUrl . '/api.php?action=' . $action);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => json_encode($body),
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $resp = curl_exec($ch);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($resp === false) {
            return ['valid' => false, 'error' => 'network', 'message' => $err ?: 'Request failed.'];
        }
        $data = json_decode((string) $resp, true);
        return is_array($data) ? $data : ['valid' => false, 'error' => 'bad_response', 'message' => 'Malformed server response.'];
    }

    /** Activate a license key on this install. */
    public function activate(string $licenseKey, ?string $machineName = null): array
    {
        $key = trim($licenseKey);
        if ($key === '') throw new InvalidArgumentException('A license key is required.');
        $data = $this->api('activate', [
            'app'          => $this->appSlug,
            'license_key'  => $key,
            'machine_id'   => $this->getMachineId(),
            'machine_name' => $machineName ?? (gethostname() ?: null),
        ]);
        if (!empty($data['valid']) && !empty($data['token'])) {
            $this->state['key']   = $key;
            $this->state['token'] = $data['token'];
            $this->saveState();
        }
        return $data;
    }

    /** Online heartbeat: refresh the token, catch revocation / expiry. */
    public function validateOnline(): array
    {
        $key = $this->getLicenseKey();
        if (!$key) return ['valid' => false, 'error' => 'no_license'];
        $data = $this->api('validate', [
            'app'         => $this->appSlug,
            'license_key' => $key,
            'machine_id'  => $this->getMachineId(),
        ]);
        if (!empty($data['valid']) && !empty($data['token'])) {
            $this->state['token'] = $data['token'];
            $this->saveState();
        } elseif (isset($data['valid']) && $data['valid'] === false
            && in_array($data['error'] ?? '', ['revoked', 'expired', 'invalid_license', 'not_activated'], true)) {
            unset($this->state['token']);
            $this->saveState();
        }
        return $data;
    }

    /* --------------------------- offline JWT -------------------------- */
    private static function b64urlDecode(string $txt): string
    {
        $r = strlen($txt) % 4;
        if ($r) $txt .= str_repeat('=', 4 - $r);
        return (string) base64_decode(strtr($txt, '-_', '+/'));
    }

    /**
     * Verify the cached token offline using only the public key.
     * @return array|null claims on success, null otherwise.
     */
    public function verifyOffline(): ?array
    {
        $token = $this->getToken();
        if (!$token) return null;
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;

        $signed = $parts[0] . '.' . $parts[1];
        $sig    = self::b64urlDecode($parts[2]);
        $pub    = openssl_pkey_get_public($this->publicKeyPem);
        if ($pub === false) return null;
        if (openssl_verify($signed, $sig, $pub, OPENSSL_ALGO_SHA256) !== 1) return null;

        $claims = json_decode(self::b64urlDecode($parts[1]), true);
        if (!is_array($claims)) return null;

        $now = time();
        if (($claims['iss'] ?? '') !== 'AKMS') return null;
        if (!empty($claims['exp']) && $now >= (int) $claims['exp']) return null;
        if (!empty($claims['lic_exp']) && $now >= (int) $claims['lic_exp']) return null;
        if (($claims['scope'] ?? '') === 'app' && $this->appSlug
            && strcasecmp((string) ($claims['app'] ?? ''), (string) $this->appSlug) !== 0) return null;
        if (!empty($claims['mid']) && $claims['mid'] !== hash('sha256', $this->getMachineId())) return null;

        return $claims;
    }

    /**
     * Is this install licensed right now? Offline check first, then an online
     * refresh if the offline grace has lapsed.
     */
    public function isLicensed(): bool
    {
        if ($this->verifyOffline() !== null) return true;
        if (!$this->getLicenseKey()) return false;
        $online = $this->validateOnline();
        return !empty($online['valid']);
    }

    /** Release this install's activation slot and clear local state. */
    public function deactivate(): array
    {
        $key = $this->getLicenseKey();
        $data = ['ok' => true];
        if ($key) {
            $data = $this->api('deactivate', [
                'app'         => $this->appSlug,
                'license_key' => $key,
                'machine_id'  => $this->getMachineId(),
            ]);
        }
        unset($this->state['key'], $this->state['token']);
        $this->saveState();
        return $data;
    }
}
