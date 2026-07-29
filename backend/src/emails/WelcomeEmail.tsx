import {
  Html,
  Head,
  Body,
  Container,
  Heading,
  Text,
  Button,
  Section,
} from "@react-email/components";

interface WelcomeEmailProps {
  username: string;
  loginUrl: string;
}

const body: React.CSSProperties = {
  backgroundColor: "#0a0a0a",
  color: "#e5e5e5",
  fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif",
  padding: "24px",
};

const container: React.CSSProperties = { maxWidth: "480px", margin: "0 auto" };

const button: React.CSSProperties = {
  backgroundColor: "#16a34a",
  color: "#ffffff",
  textDecoration: "none",
  padding: "10px 18px",
  borderRadius: "6px",
  fontSize: "14px",
};

export function WelcomeEmail({ username, loginUrl }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Heading style={{ fontSize: "20px", margin: "0 0 12px" }}>
            Welcome to Music Streaming Tools, {username}!
          </Heading>
          <Text style={{ fontSize: "14px", lineHeight: "1.6", color: "#a3a3a3" }}>
            Your account is ready. Connect any API of your choice and turn the song you&apos;re
            playing into textures with the SVG Texture Labs or export your playlists as text files.
          </Text>
          <Section style={{ margin: "24px 0" }}>
            <Button href={loginUrl} style={button}>
              Log in to get started
            </Button>
          </Section>
          <Text style={{ fontSize: "12px", color: "#737373" }}>
            If you didn&apos;t create this account, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default WelcomeEmail;
