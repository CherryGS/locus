# Local HTTPS fixtures

`preview-cert.der` and `preview-key.der` are a self-signed P-256 test certificate
and PKCS#8 private key. They are public fixture data, not service credentials.
The certificate names `image.civitai.com` and expires in August 2126. The adapter
tests resolve that name to an ephemeral loopback listener and trust this
certificate only in their injected client, exercising the real provider URL and
TLS validation without contacting the remote host.
