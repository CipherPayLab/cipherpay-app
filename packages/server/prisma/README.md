# delete database
docker compose down -v

# generate database
docker compose up -d db

# generate tables (sync schema → DB; use after git pull when schema changed)
npx prisma db push

# If you see Prisma P2022 / "column ... does not exist", run `db push` again from `packages/server`
# (or apply SQL under `prisma/migrations/` manually).

# install

npm i prisma @prisma/client

# generate client from schema.prisma

npx prisma generate

# optional: introspect from DB if you changed SQL directly

npx prisma db pull

mysql://cipherpay:cipherpay@127.0.0.1:3307/cipherpay_server

###Usage
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// create-or-link user
export async function upsertUser(ownerKey: string, authPubX: string, authPubY: string) {
return prisma.users.upsert({
where: { owner_cipherpay_pub_key: ownerKey },
update: { auth_pub_x: authPubX, auth_pub_y: authPubY },
create: { owner_cipherpay_pub_key: ownerKey, auth_pub_x: authPubX, auth_pub_y: authPubY },
});
}

// store encrypted message
export async function storeMessage(recipientKey: string, senderKey: string | null, ciphertext: Buffer, kind: string, contentHash: string) {
return prisma.messages.create({
data: { recipient_key: recipientKey, sender_key: senderKey, ciphertext, kind, content_hash: contentHash },
});
}

// paginated inbox
export async function getInbox(recipientKey: string, limit = 50, cursor?: bigint) {
return prisma.messages.findMany({
where: { recipient_key: recipientKey },
orderBy: { created_at: "desc" },
take: limit,
...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});
}
