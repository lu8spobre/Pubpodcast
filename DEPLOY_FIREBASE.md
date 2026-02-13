# Deploy Firebase Hosting + GitHub (v1.3)

## 1) Pré-requisitos
- Ter um projeto no Firebase.
- Ter o repositório no GitHub.

## 2) Configurar o Project ID
Abra `.firebaserc` e troque:
- `SEU_FIREBASE_PROJECT_ID` pelo ID real do seu projeto Firebase.

## 3) Criar Service Account para GitHub Actions
No Firebase Console:
1. `Project settings` -> `Service accounts`.
2. Clique em `Generate new private key`.
3. Baixe o JSON.

## 4) Criar secrets no GitHub
No repositório GitHub:
1. `Settings` -> `Secrets and variables` -> `Actions`.
2. Crie os secrets:
   - `FIREBASE_PROJECT_ID` = seu project id (ex: `meu-site-12345`)
   - `FIREBASE_SERVICE_ACCOUNT` = conteúdo completo do JSON da service account

## 5) Subir o código
Na raiz do projeto:
```bash
git add .
git commit -m "chore: firebase hosting + github actions deploy"
git push origin main
```

## 6) Como funciona
- Push em `main`: deploy automático para produção (`channelId: live`).
- Pull Request: deploy de preview automático (`channelId: pr-<numero-da-pr>`).

## 7) Cache configurado
No `firebase.json`:
- Arquivos estáticos (`.js`, `.css`, imagens, fontes): cache longo com `immutable`.
- HTML: sem cache (`no-cache, no-store, must-revalidate`) para publicar mudanças imediatamente.

