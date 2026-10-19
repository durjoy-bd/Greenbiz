# Greenbiz source code

- **App-Website/** contains the Android app, responsive website, optional business API, database migrations, tests and deployment files. Read App-Website/README.md for development and Android build instructions.
- **Managed-AI-Service/** contains the hosted AI service, its website, database schema, migrations and tests. Read its README.md for service instructions.

Both projects include their package manifests and lockfiles. Dependencies and generated build files are recreated during setup. Private databases, temporary files, signing keys and provider secrets are not part of the source copy. The existing hosted AI key remains securely configured on the service.

These are copies. The original project folders remain in their original location.
