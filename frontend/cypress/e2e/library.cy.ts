// E2E: the critical Library path — a logged-in user builds a nested folder tree,
// copies a _debug template into it, renames it, and the whole tree survives a
// page reload (proving it's persisted in the DB, not just client state).
// Needs the full stack running (backend :3000 + frontend :5173).

const BACKEND = Cypress.env("backendUrl") as string;

describe("template library tree", () => {
  it("builds a nested tree with a copied template that survives a reload", () => {
    const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const user = {
      email: `cy_${tag}@e2e.local`,
      username: `cy_${tag}`,
      password: "password123",
    };
    const folderA = `A-${tag}`;
    const folderB = `B-${tag}`;
    const tplName = `Copied-${tag}`;

    // Register + log in via the API (cookie is host-scoped to 127.0.0.1).
    cy.request("POST", `${BACKEND}/api/auth/register`, user);
    cy.request("POST", `${BACKEND}/api/auth/login`, {
      username: user.username,
      password: user.password,
    });

    cy.visit("/");
    cy.get('[data-cy="tool-immersive-display"]').click();

    // Folder A at the root.
    cy.get('[data-cy="new-folder-btn"]').click();
    cy.get('[data-cy="rename-input"]').clear().type(`${folderA}{enter}`);
    cy.contains('[data-cy="folder"]', folderA).should("be.visible");

    // Subfolder B inside A (select A, then create a folder -> goes inside it).
    cy.contains('[data-cy="folder"]', folderA).click();
    cy.get('[data-cy="new-folder-btn"]').click();
    cy.get('[data-cy="rename-input"]').clear().type(`${folderB}{enter}`);
    cy.contains('[data-cy="folder"]', folderB).should("be.visible");

    // Copy a read-only _debug template, then collapse _debug again so the only
    // template left on screen is the one we paste.
    cy.contains('[data-cy="folder"]', "_debug").click(); // expand
    cy.get('[data-cy="template"]').first().rightclick();
    cy.get('[data-cy="context-menu"]').contains("Copy").click();
    cy.contains('[data-cy="folder"]', "_debug").click(); // collapse

    // Paste into B. Renaming B earlier collapsed it (open-state is keyed by
    // path), so expand B to reveal the pasted template.
    cy.contains('[data-cy="folder"]', folderB).rightclick();
    cy.get('[data-cy="context-menu"]').contains("Paste").click();
    cy.contains('[data-cy="folder"]', folderB).click(); // expand B
    cy.get('[data-cy="template"]').should("have.length", 1).rightclick();
    cy.get('[data-cy="context-menu"]').contains("Rename").click();
    cy.get('[data-cy="rename-input"]').clear().type(`${tplName}{enter}`);
    cy.contains('[data-cy="template"]', tplName).should("be.visible");

    // Reload: the tree is rebuilt from the DB. Expand A -> B -> see the template.
    cy.reload();
    cy.get('[data-cy="tool-immersive-display"]').click();
    cy.contains('[data-cy="folder"]', folderA).should("be.visible").click();
    cy.contains('[data-cy="folder"]', folderB).should("be.visible").click();
    cy.contains('[data-cy="template"]', tplName).should("be.visible");
  });
});
