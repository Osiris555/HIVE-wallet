// apps/mobile/src/screens/ValidatorsScreen.tsx
// VALIDATOR DISCOVERY & SELECTION UI – Phase 0
// Shows validators, APY, voting power, and allows delegation entry point

import React, { useEffect, useState } from 'react'
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert } from 'react-native'

import { fetchValidators } from '../chain/validators'

interface Validator {
  address: string
  name: string
  commission: number
  apy: number
  votingPower: number
}

export default function ValidatorsScreen() {
  const [validators, setValidators] = useState<Validator[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    async function loadValidators() {
      try {
        const list = await fetchValidators()
        setValidators(list)
      } catch (e) {
        Alert.alert('Error', 'Unable to load validators')
      } finally {
        setLoading(false)
      }
    }

    loadValidators()
  }, [])

  function renderValidator({ item }: { item: Validator }) {
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => Alert.alert('Delegate', `Stake with ${item.name}`)}
      >
        <Text style={styles.name}>{item.name}</Text>
        <Text>APY: {item.apy}%</Text>
        <Text>Commission: {item.commission}%</Text>
        <Text>Voting Power: {item.votingPower.toLocaleString()}</Text>
      </TouchableOpacity>
    )
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <Text>Loading validators...</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Validators</Text>

      <FlatList
        data={validators}
        keyExtractor={item => item.address}
        renderItem={renderValidator}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 15
  },
  card: {
    padding: 15,
    borderRadius: 12,
    backgroundColor: '#f4f4f4',
    marginBottom: 12
  },
  name: {
    fontSize: 18,
    fontWeight: '600'
  }
})