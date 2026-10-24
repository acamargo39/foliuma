<p align="center"><img src="brand/foliuma-logo.svg" alt="Foliuma" width="320"></p>

# Foliuma

Anotações no estilo OneNote, com tarefas, Kanban, calendário, cronômetro, comentários e sincronização online pelo **Supabase**. Funciona no navegador e pode ser **instalado no celular** como aplicativo (PWA), inclusive offline.

## O que tem nesta pasta

| Arquivo | Para que serve |
|---|---|
| `index.html` | O aplicativo completo |
| `config.js` | Onde você cola a URL e a chave do seu Supabase |
| `supabase-shim.js` | Liga o app ao Supabase (login, banco, tempo real) |
| `supabase/schema.sql` | Cria as tabelas e as regras de segurança no Supabase |
| `sw.js` e `manifest.webmanifest` | Permitem instalar no celular e usar offline |
| `icons/` | Ícones do aplicativo |

---

## Passo 1 — Criar o banco no Supabase (5 minutos)

1. Entre em [supabase.com](https://supabase.com), crie uma conta e clique em **New project**. Escolha um nome, uma senha para o banco e a região **South America (São Paulo)**.
2. Quando o projeto terminar de criar, abra **SQL Editor → New query**.
3. Copie todo o conteúdo de `supabase/schema.sql`, cole e clique em **Run**. Deve aparecer "Success".
4. Vá em **Project Settings → API** (ou **Data API**) e copie:
   - **Project URL** (algo como `https://abcdxyz.supabase.co`)
   - a chave **anon public**
5. Abra o arquivo `config.js` num editor de texto e troque os dois valores:

```js
window.CADERNO_CONFIG = {
  SUPABASE_URL: 'https://abcdxyz.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...sua chave anon...'
};
```

> A chave **anon** pode ficar pública: quem protege os dados são as regras do `schema.sql`. **Nunca** use a chave `service_role` neste arquivo.

## Passo 2 — Enviar para o GitHub

### Opção A: pelo navegador (sem instalar nada)

1. Entre em [github.com](https://github.com) e clique em **New repository**.
2. Dê o nome `foliuma`, deixe **Public** e clique em **Create repository**.
3. Na página do repositório, clique em **uploading an existing file**.
4. Arraste **todo o conteúdo desta pasta** (os arquivos e as pastas `icons` e `supabase`, não a pasta inteira por fora) e clique em **Commit changes**.

### Opção B: pelo terminal, com Git

```bash
cd foliuma
git init
git add .
git commit -m "Foliuma versão inicial"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/foliuma.git
git push -u origin main
```

## Passo 3 — Publicar o site (GitHub Pages, grátis)

1. No repositório, vá em **Settings → Pages**.
2. Em **Source**, escolha **Deploy from a branch**; em **Branch**, escolha **main** e a pasta **/ (root)**. Clique em **Save**.
3. Aguarde 1 a 2 minutos. O endereço aparece no topo da página, por exemplo:
   `https://SEU-USUARIO.github.io/foliuma/`

> Também funciona na **Vercel** ou **Netlify**: basta importar o repositório; não há etapa de build.

## Passo 4 — Ajustar o login no Supabase

1. No Supabase, abra **Authentication → URL Configuration**.
2. Em **Site URL**, cole o endereço do GitHub Pages.
3. Em **Redirect URLs**, adicione o mesmo endereço. Isso faz os links de confirmação e de acesso por e-mail voltarem para o app.
4. (Opcional) Em **Authentication → Sign In / Providers → Email**, desligue **Confirm email** se quiser entrar sem confirmar o e-mail.

## Passo 5 — Instalar no celular

- **Android (Chrome, Edge ou Samsung Internet):** abra o endereço, toque no menu **⋮** e escolha **Instalar app** ou **Adicionar à tela inicial**.
- **iPhone (Safari):** abra o endereço, toque em **Compartilhar** e escolha **Adicionar à Tela de Início**. Para receber notificações, o iPhone precisa do iOS 16.4 ou mais recente e o app aberto pela Tela de Início.
- Dentro do app também há o atalho **menu ⋯ → Instalar no celular…**.

Depois de instalado, o Foliuma abre em tela cheia, funciona offline e sincroniza assim que a internet voltar.

---

## Login e senha

O Foliuma tem duas camadas de login, que podem ser usadas juntas:

**1. Login da conta (Supabase)** — com o banco online configurado, o app só abre depois de entrar com e-mail e senha (`REQUIRE_LOGIN: true` no `config.js`; use `false` para permitir o uso sem conta). Na tela de entrada há **Esqueci minha senha**, que envia um link por e-mail para criar uma senha nova, e em **menu ⋯ → Conta e sincronização** há **Alterar senha**. Para o link de recuperação funcionar, o endereço do site precisa estar em **Authentication → URL Configuration** no Supabase.

**2. Login do app (usuário e senha)** — funciona mesmo sem Supabase. Em **menu ⋯ → Criar login e senha**, escolha um usuário e uma senha. O app passa a pedir o login ao abrir, bloqueia sozinho após um tempo sem uso (5, 15, 30 ou 60 minutos) e pode ser bloqueado a qualquer momento pelo cadeado ao lado do logo ou por **Ctrl Shift L**. Ao criar, você recebe um **código de recuperação**: guarde-o, ele é a única forma de redefinir a senha se você esquecê-la. A senha nunca é salva em texto, apenas uma impressão criptográfica (PBKDF2-SHA256). Depois de 5 tentativas erradas, o app impõe uma pausa crescente.

Observação: o login do app protege o acesso pela tela. Quem tiver acesso técnico ao aparelho ainda pode ler os dados guardados no navegador; para proteção total use a conta online com verificação em duas etapas.

## Verificação em duas etapas (recomendado)

Protege sua conta com um código do celular além da senha.

**Configurar no Supabase (uma vez):**
1. Rode de novo o `supabase/schema.sql` atualizado no **SQL Editor** (pode rodar por cima, não apaga dados). Ele cria a regra que exige o código no banco.
2. Confira nas configurações de autenticação do Supabase (seção **Multi-Factor / MFA**) se o fator **TOTP** está habilitado. Ele vem ligado por padrão.

**Ativar na sua conta:**
1. No Foliuma, abra **menu ⋯ → Conta e sincronização → Verificação em duas etapas → Ativar**.
2. Escaneie o QR code com um app autenticador (Google Authenticator, Microsoft Authenticator, Authy ou 1Password).
3. Digite o código de 6 dígitos para confirmar.

A partir daí, todo login pede o código. Guarde a **chave** mostrada na ativação em um lugar seguro: com ela você configura o código em outro celular.

**Perdeu o celular?** O administrador do projeto remove a verificação do usuário no painel do Supabase (**Authentication → Users**, escolha o usuário e remova o fator MFA). Depois é só entrar com a senha e ativar de novo.

Na mesma tela há o botão **Sair de todos os aparelhos**, que encerra a sessão em todos os celulares e computadores.

## Contas e compartilhamento

- Cada pessoa cria sua conta pela tela **Entrar** do app (e-mail e senha, ou link de acesso por e-mail).
- **Cadernos privados** são visíveis só para o dono.
- **Cadernos compartilhados** (menu ⋯ do caderno → Compartilhar) são visíveis e editáveis por **todas as pessoas com conta** neste projeto Supabase.
- Para controlar quem entra: depois de criar as contas da sua equipe, desative novos cadastros em **Authentication → Sign In / Providers → Allow new users to sign up** e convide pessoas em **Authentication → Users → Invite user**.

## Trazer seus dados da versão do claude.ai

1. Na versão do claude.ai, abra **menu ⋯ → Backup de tudo (.json)**.
2. No novo app, entre na sua conta e use **menu ⋯ → Importar backup…**.

Gravações de áudio e o histórico de versões não vão no backup: eles ficam onde foram criados.

## Atualizar o app no futuro

Edite os arquivos e envie de novo para o GitHub (Opção A ou B). O GitHub Pages publica sozinho. Se mudar algo importante, aumente o número em `sw.js` (`foliuma-v1` → `foliuma-v2`) para os celulares baixarem a versão nova na hora.

## Testar no computador antes de publicar

```bash
cd foliuma
python3 -m http.server 8080
```

Abra `http://localhost:8080`. Abrir o `index.html` com duplo clique também funciona, mas sem o modo offline.

## Diferenças em relação à versão do claude.ai

- **Assistente de IA:** fica desligado, porque ele usa o Claude de dentro do claude.ai. Para ter IA aqui seria preciso um pequeno servidor com uma chave de API (por exemplo, uma Edge Function do Supabase).
- **Plano gratuito do Supabase:** 500 MB de banco e pausa do projeto após 1 semana sem uso (reative pelo painel com um clique). Páginas com muitas imagens e áudios ocupam mais espaço.
- **Conflitos de edição:** se duas pessoas editarem a mesma página ao mesmo tempo, vale a última versão salva. O app avisa quando alguém muda a página que você está vendo.

## Identidade visual

A pasta `brand/` tem o logo em vários formatos:

| Arquivo | Uso |
|---|---|
| `foliuma-logo.svg` / `.png` | Logo com nome, para fundos claros |
| `foliuma-logo-dark.svg` / `.png` | Logo com nome, para fundos escuros |
| `foliuma-mark.svg` / `foliuma-mark-1024.png` | Só o símbolo (ícone do app) |
| `foliuma-mark-maskable.svg` | Símbolo com margem para ícones redondos do Android |
| `foliuma-leaf.svg` / `foliuma-leaf-white.svg` | Só a folha, sem fundo, em índigo ou branca |

Cores: índigo `#8383F7` → `#4545C0` (degradê), destaque `#5B5BD6`, texto `#151924`.
