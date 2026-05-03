import "expo-dev-client";

import { StatusBar, StyleSheet, Text, View } from "react-native";

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.kicker}>Expo Go connected</Text>
      <Text style={styles.title}>x-master</Text>
      <Text style={styles.body}>
        The Expo native entry point is running. Your existing Next.js app is
        still in the app directory.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 28,
    backgroundColor: "#101820",
  },
  kicker: {
    color: "#7BDCB5",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: 0,
  },
  body: {
    maxWidth: 320,
    color: "#D4DEE8",
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
});
