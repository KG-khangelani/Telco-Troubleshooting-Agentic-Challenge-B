import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

async function main() {
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage, "/app/agent/.pi/agent/models.json");
    const targetModel = modelRegistry.find("openrouter", "Qwen3.5-35B-A3B");
    console.log(JSON.stringify(targetModel, null, 2));
}
main();
