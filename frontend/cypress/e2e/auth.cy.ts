// E2E: the login flow — happy path and the sad path (wrong password).
// Needs the full stack running (backend :3000 + frontend :5173).

const BACKEND = Cypress.env("backendUrl") as string;

function uniqueUser() {
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  return {
    email: `cy_${tag}@e2e.local`,
    username: `cy_${tag}`,
    password: "password123",
  };
}

describe("authentication", () => {
  it("logs in and shows the username (happy path)", () => {
    const user = uniqueUser();
    cy.request("POST", `${BACKEND}/api/auth/register`, user);

    cy.visit("/login");
    cy.get('[data-cy="login-username"]').type(user.username);
    cy.get('[data-cy="login-password"]').type(user.password);
    cy.get('[data-cy="login-submit"]').click();

    cy.location("pathname").should("eq", "/");
    cy.get('[data-cy="user-name"]').should("contain", user.username);
  });

  it("shows an error on wrong password (sad path)", () => {
    // No registration needed: the backend returns the same unified error for an
    // unknown user as for a wrong password (no user enumeration).
    cy.visit("/login");
    cy.get('[data-cy="login-username"]').type("definitely-not-a-real-user");
    cy.get('[data-cy="login-password"]').type("wrong-password");
    cy.get('[data-cy="login-submit"]').click();

    cy.get('[data-cy="login-error"]')
      .should("be.visible")
      .and("contain", "invalid");
  });
});
